import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportPaths, main, USAGE, versionLine } from "../src/cli.js";
import { plantTree } from "./helpers.js";

let out: string[];
let err: string[];
const saved = { ...process.env };

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((c: string | Uint8Array) => (err.push(String(c)), true));
  delete process.env["DATABASE_URL"];
  delete process.env["MIGRATIONS_LINT_ROOT"];
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...saved };
});

describe("the CLI", () => {
  it("prints the usage for help", async () => {
    expect(await main(["help"])).toBe(0);
    expect(out.join("")).toBe(`${USAGE}\n`);
  });

  it("refuses an unknown verb with exit 2", async () => {
    expect(await main(["drop"])).toBe(2);
    expect(err.join("")).toContain("unknown verb 'drop'");
  });

  it.each([
    [["migrate", "--force"], "migrate takes only --dry-run"],
    [["partitions"], "partitions takes one sub-verb: ensure"],
    [["partitions", "ensure", "--days"], "partitions ensure takes only --days N"],
    [["partitions", "ensure", "--days", "seven"], "whole number"],
    [["partitions", "ensure", "--days", "401"], "at most 400"],
    [["analyze"], "analyze takes exactly one table name"],
    [["analyze", "a", "b"], "analyze takes exactly one table name"],
    [["check", "x"], "check takes no argument"],
    [["head", "x"], "head takes no argument"],
    [["lint", "--root"], "--root needs a directory"],
    [["version", "x"], "version takes no argument"],
  ])("refuses %j as a usage error before any database is needed", async (argv, msg) => {
    expect(await main(argv)).toBe(2);
    expect(err.join("")).toContain(msg);
  });

  it.each([[["check"]], [["partitions", "ensure", "--days", "0"]], [["migrate", "--dry-run"]]])("passes %j's usage check and then refuses it without DATABASE_URL, exit 2", async (argv) => {
    expect(await main(argv)).toBe(2);
    expect(err.join("")).toContain("DATABASE_URL");
    expect(err.join("")).not.toContain("usage:");
  });

  it("lints the migrations of the tree it is given", async () => {
    const t = plantTree({ "0001_a.sql": "create table a(id int);\n-- rollback: drop table a; delete from schema_migrations where version = 1;\n" });
    try {
      expect(await main(["lint", "--root", t.root])).toBe(0);
      expect(out.join("")).toContain("✓ migrations ok (1 file(s)");
    } finally {
      t.done();
    }
  });

  const LEDGER = `version\tname\tchecksum\n1\t0001_a.sql\t${"a".repeat(64)}\n2\t0002_b.sql\t${"b".repeat(64)}\n`;
  const withBaseline = (): ReturnType<typeof plantTree> => {
    const t = plantTree({ "0003_c.sql": "x;\n" });
    mkdirSync(join(t.root, "db", "baseline"));
    writeFileSync(join(t.root, "db", "baseline", "ledger.tsv"), LEDGER);
    writeFileSync(join(t.root, "db", "baseline", "0002_baseline.sql"), "create table a(id int);\n");
    writeFileSync(join(t.root, "package.json"), JSON.stringify({ version: "1.2.3" }));
    return t;
  };

  it("version: the package version and the newest schema version, baseline included", () => {
    const t = withBaseline();
    try {
      expect(versionLine(t.root, {})).toBe("viafrei-database 1.2.3 schema-head 3");
      expect(versionLine(t.root, { VF_DB_MIGRATIONS_DIR: join(t.root, "none") })).toBe("viafrei-database 1.2.3 schema-head 2");
    } finally {
      t.done();
    }
  });

  it("version through main: reads the schema dirs from the environment, needs no database", async () => {
    const t = withBaseline();
    try {
      process.env["VF_DB_MIGRATIONS_DIR"] = join(t.root, "db", "migrations");
      process.env["VF_DB_BASELINE_DIR"] = join(t.root, "db", "baseline");
      expect(await main(["version"])).toBe(0);
      expect(out.join("")).toMatch(/^viafrei-database \S+ schema-head 3\n$/);
    } finally {
      t.done();
    }
  });

  it("a broken baseline is exit 2 with its reason, not a crash", async () => {
    const t = withBaseline();
    try {
      writeFileSync(join(t.root, "db", "baseline", "stray.txt"), "");
      process.env["VF_DB_BASELINE_DIR"] = join(t.root, "db", "baseline");
      expect(await main(["version"])).toBe(2);
      expect(err.join("")).toContain("unexpected file(s) stray.txt");
    } finally {
      t.done();
    }
  });

  it("export-migrations tars exactly the schema directories that exist", () => {
    const t = withBaseline();
    try {
      expect(exportPaths(t.root)).toEqual(["db/baseline", "db/migrations"]);
      mkdirSync(join(t.root, "db", "roles"));
      expect(exportPaths(t.root)).toEqual(["db/baseline", "db/migrations", "db/roles"]);
    } finally {
      t.done();
    }
  });

  it("ledger-compare: exit 0 on an equal export, 1 naming a difference, 2 on an unreadable file or no baseline", async () => {
    const t = withBaseline();
    try {
      process.env["VF_DB_MIGRATIONS_DIR"] = join(t.root, "db", "migrations");
      process.env["VF_DB_BASELINE_DIR"] = join(t.root, "db", "baseline");
      const file = join(t.root, "export.tsv");
      writeFileSync(file, LEDGER);
      expect(await main(["ledger-compare", file])).toBe(0);
      expect(out.join("")).toContain("✓ the export holds all 2 versions");
      writeFileSync(file, LEDGER.replace("b".repeat(64), "c".repeat(64)));
      expect(await main(["ledger-compare", file])).toBe(1);
      expect(err.join("")).toContain("✗ version 2 (0002_b.sql): the checksum differs");
      expect(await main(["ledger-compare", join(t.root, "missing.tsv")])).toBe(2);
      expect(err.join("")).toContain("cannot read the export");
      expect(await main(["ledger-compare"])).toBe(2);
      process.env["VF_DB_BASELINE_DIR"] = join(t.root, "none");
      expect(await main(["ledger-compare", file])).toBe(2);
      expect(err.join("")).toContain("this image carries no baseline");
    } finally {
      t.done();
    }
  });
});
