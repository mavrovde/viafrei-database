import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assembleSchema,
  BaselineError,
  baselineEntry,
  baselineScript,
  compareLedgerExport,
  LEDGER_HEADER,
  loadSchema,
  parseLedgerTsv,
  readBaseline,
  type Baseline,
} from "../src/migrations/baseline.js";
import { describeFile, sha256Hex, type MigrationFile } from "../src/migrations/files.js";
import { CREATE_LEDGER, ledgerInsert, migrate } from "../src/migrations/migrate.js";
import { fakePsql } from "./helpers.js";

const sum = (n: number): string => sha256Hex(Buffer.from(`original ${String(n)}`));
const row = (n: number, name = `${String(n).padStart(4, "0")}_m${String(n)}.sql`): string => `${String(n)}\t${name}\t${sum(n)}`;
const tsv = (n: number): string => `${LEDGER_HEADER}\n${Array.from({ length: n }, (_, i) => row(i + 1)).join("\n")}\n`;
const DUMP = "create table a(id int);\nselect pg_catalog.set_config('search_path', '', false);\n";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
const plant = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "vf-baseline-"));
  dirs.push(root);
  for (const [n, c] of Object.entries(files)) writeFileSync(join(root, n), c);
  return root;
};
const baseline = (head: number): Baseline => {
  const b = readBaseline(plant({ "ledger.tsv": tsv(head), [`${String(head).padStart(4, "0")}_baseline.sql`]: DUMP }));
  if (b === null) throw new Error("no baseline");
  return b;
};

/** The file a ledger.tsv row of `row(n)` stands for: same name, bytes whose checksum is `sum(n)`. */
const carried = (n: number): MigrationFile => describeFile(`${String(n).padStart(4, "0")}_m${String(n)}.sql`, Buffer.from(`original ${String(n)}`));

describe("parseLedgerTsv", () => {
  it("reads a contiguous ledger, with or without a final newline", () => {
    expect(parseLedgerTsv(tsv(2))).toEqual([
      { version: 1, name: "0001_m1.sql", checksum: sum(1) },
      { version: 2, name: "0002_m2.sql", checksum: sum(2) },
    ]);
    expect(parseLedgerTsv(tsv(2).trimEnd())).toHaveLength(2);
  });

  const refusals: [string, string, string][] = [
    ["a wrong header", `version,name,checksum\n${row(1)}\n`, "the first line must be"],
    ["no rows", `${LEDGER_HEADER}\n`, "no rows"],
    ["two columns", `${LEDGER_HEADER}\n1\t0001_a.sql\n`, "line 2: expected 3 tab-separated columns, got 2"],
    ["a zero-padded version", `${LEDGER_HEADER}\n01\t0001_a.sql\t${sum(1)}\n`, "line 2: the version must be a positive whole number"],
    ["a gap", `${LEDGER_HEADER}\n${row(1)}\n${row(3)}\n`, "line 3: expected version 2 (contiguous from 1"],
    ["a duplicate", `${LEDGER_HEADER}\n${row(1)}\n${row(1)}\n`, "line 3: expected version 2"],
    ["a name for another version", `${LEDGER_HEADER}\n1\t0002_a.sql\t${sum(1)}\n`, "is not a migration name for version 1"],
    ["a name with a quote", `${LEDGER_HEADER}\n1\t0001_a'b.sql\t${sum(1)}\n`, "is not a migration name"],
    ["an upper-case checksum", `${LEDGER_HEADER}\n1\t0001_a.sql\t${sum(1).toUpperCase()}\n`, "64 lower-case hex"],
    ["a CRLF line", `${LEDGER_HEADER}\r\n${row(1)}\r\n`, "the first line must be"],
  ];
  for (const [name, text, message] of refusals) {
    it(`refuses ${name}`, () => {
      expect(() => parseLedgerTsv(text)).toThrow(BaselineError);
      expect(() => parseLedgerTsv(text)).toThrow(message);
    });
  }
});

describe("readBaseline", () => {
  it("is null when the directory does not exist", () => {
    expect(readBaseline(join(tmpdir(), "vf-no-such-baseline-dir"))).toBeNull();
  });

  it("reads the file and turns each ledger row into a baseline entry with the ORIGINAL checksum", () => {
    const b = baseline(3);
    expect([b.head, b.name, b.bytes.toString(), b.checksum]).toEqual([3, "0003_baseline.sql", DUMP, sha256Hex(Buffer.from(DUMP))]);
    expect(b.entries.map((e) => [e.version, e.name, e.checksum, e.baseline, e.bytes.length])).toEqual([1, 2, 3].map((n) => [n, `${String(n).padStart(4, "0")}_m${String(n)}.sql`, sum(n), true, 0]));
  });

  const refusals: [string, Record<string, string>, string][] = [
    ["a stray file", { "ledger.tsv": tsv(1), "0001_baseline.sql": DUMP, "notes.md": "" }, "unexpected file(s) notes.md"],
    ["no SQL file", { "ledger.tsv": tsv(1) }, "expected exactly one NNNN_baseline.sql, found 0"],
    ["two SQL files", { "ledger.tsv": tsv(2), "0001_baseline.sql": DUMP, "0002_baseline.sql": DUMP }, "found 2"],
    ["no ledger", { "0001_baseline.sql": DUMP }, "ledger.tsv is missing"],
    ["a file numbered off the head", { "ledger.tsv": tsv(2), "0001_baseline.sql": DUMP }, "0001_baseline.sql must be numbered 0002"],
    ["an empty file", { "ledger.tsv": tsv(1), "0001_baseline.sql": "" }, "0001_baseline.sql is empty"],
  ];
  for (const [name, files, message] of refusals) {
    it(`refuses ${name}`, () => {
      const dir = plant(files);
      expect(() => readBaseline(dir)).toThrow(BaselineError);
      expect(() => readBaseline(dir)).toThrow(message);
    });
  }

  it("ignores a dot file (an editor's or the OS's)", () => {
    expect(readBaseline(plant({ "ledger.tsv": tsv(1), "0001_baseline.sql": DUMP, ".DS_Store": "" }))?.head).toBe(1);
  });
});

describe("assembleSchema and loadSchema", () => {
  it("puts the baseline's entries before the files", () => {
    const s = assembleSchema(baseline(2), [describeFile("0003_c.sql", Buffer.from("x;\n"))]);
    expect(s.all.map((f) => [f.version, f.baseline === true])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);
  });

  it("refuses a file the baseline already stands for", () => {
    expect(() => assembleSchema(baseline(2), [describeFile("0002_b.sql", Buffer.from("x;\n"))])).toThrow(
      "0002_b.sql: the baseline already stands for versions 1..2 and ledger.tsv names version 2 0002_m2.sql; migrations after it start at 0003",
    );
  });

  it("takes a CARRIED file: the baseline's newest version under its own name and checksum", () => {
    const s = assembleSchema(baseline(2), [carried(2), describeFile("0003_c.sql", Buffer.from("x;\n"))]);
    expect(s.baseline?.carried?.map((f) => f.name)).toEqual(["0002_m2.sql"]);
    expect(s.files.map((f) => f.name)).toEqual(["0003_c.sql"]);
    expect(s.all.map((f) => [f.name, f.baseline === true])).toEqual([
      ["0001_m1.sql", true],
      ["0002_m2.sql", true],
      ["0003_c.sql", false],
    ]);
  });

  it("refuses a carried file whose bytes are not the ones ledger.tsv records", () => {
    expect(() => assembleSchema(baseline(2), [describeFile("0002_m2.sql", Buffer.from("original 2, edited"))])).toThrow(
      "0002_m2.sql: the baseline carries version 2 with another checksum in ledger.tsv",
    );
  });

  it("refuses carried files that stop short of the head", () => {
    expect(() => assembleSchema(baseline(3), [carried(1), carried(3)])).toThrow("0001_m1.sql: carried files must run without a gap up to the baseline's head 0003");
    expect(() => assembleSchema(baseline(3), [carried(2)])).toThrow("0002_m2.sql: carried files must run without a gap up to the baseline's head 0003");
  });

  it("without a baseline is the files alone", () => {
    const f = describeFile("0001_a.sql", Buffer.from("x;\n"));
    expect(assembleSchema(null, [f]).all).toEqual([f]);
  });

  it("loads a baseline with no migrations directory at all", () => {
    const root = plant({});
    const bdir = join(root, "baseline");
    mkdirSync(bdir);
    writeFileSync(join(bdir, "ledger.tsv"), tsv(2));
    writeFileSync(join(bdir, "0002_baseline.sql"), DUMP);
    const s = loadSchema(join(root, "migrations"), bdir);
    expect([s.baseline?.head, s.files.length, s.all.length]).toEqual([2, 0, 2]);
  });

  it("loads the files after the baseline from the migrations directory", () => {
    const root = plant({});
    const bdir = join(root, "baseline");
    const mdir = join(root, "migrations");
    mkdirSync(bdir);
    mkdirSync(mdir);
    writeFileSync(join(bdir, "ledger.tsv"), tsv(2));
    writeFileSync(join(bdir, "0002_baseline.sql"), DUMP);
    writeFileSync(join(mdir, "0003_c.sql"), "create table c(id int);\n");
    expect(loadSchema(mdir, bdir).all.map((f) => f.name)).toEqual(["0001_m1.sql", "0002_m2.sql", "0003_c.sql"]);
  });
});

describe("baselineScript", () => {
  it("is begin; <dump bytes>, the guard newline, the search path reset, one insert per version, commit;", () => {
    const b = baseline(2);
    expect(baselineScript(b, ledgerInsert).toString()).toBe(
      `begin;\n${DUMP}\nreset search_path;\n${ledgerInsert(baselineEntry({ version: 1, name: "0001_m1.sql", checksum: sum(1) }))}\n${ledgerInsert(
        baselineEntry({ version: 2, name: "0002_m2.sql", checksum: sum(2) }),
      )}\ncommit;\n`,
    );
  });
});

describe("migrate with a baseline", () => {
  const c3 = describeFile("0003_c.sql", Buffer.from("create table c(id int);\n"));
  const after = [c3];
  const quiet = { out: () => undefined, err: () => undefined };

  it("on an empty ledger applies the baseline in ONE psql call, then the files after it", async () => {
    const b = baseline(2);
    const fake = fakePsql();
    const out: string[] = [];
    const r = await migrate({ psql: fake.run, files: after, baseline: b, out: (l) => out.push(l), err: () => undefined });
    expect(fake.calls[0]?.args).toEqual(["-c", CREATE_LEDGER]);
    const applies = fake.calls.filter((c) => c.script.length > 0);
    expect(applies.map((c) => c.script.toString())).toEqual([baselineScript(b, ledgerInsert).toString(), `begin;\ncreate table c(id int);\n\n${ledgerInsert(c3)}\ncommit;\n`]);
    expect(r.applied).toEqual(["0002_baseline.sql", "0003_c.sql"]);
    expect(fake.ledger.map((l) => l.split(" ")[0])).toEqual(["1", "2", "3"]);
    expect(out).toContain("applying the baseline 0002_baseline.sql (versions 1..2, one transaction)");
    expect(out.at(-1)).toBe("✓ 3 migration(s) applied; head = 3");
  });

  it("skips the baseline on a database that already holds all of its versions", async () => {
    const fake = fakePsql({ ledger: [`1 ${sum(1)}`, `2 ${sum(2)}`] });
    const r = await migrate({ psql: fake.run, files: after, baseline: baseline(2), ...quiet });
    expect(r.exitCode).toBe(0);
    expect(r.applied).toEqual(["0003_c.sql"]);
  });

  it("dry-run names the baseline and applies nothing", async () => {
    const fake = fakePsql();
    const out: string[] = [];
    const r = await migrate({ psql: fake.run, files: after, baseline: baseline(2), dryRun: true, out: (l) => out.push(l), err: () => undefined });
    expect(out).toEqual(["would apply the baseline 0002_baseline.sql (versions 1..2)", "would apply 0003_c.sql", "✓ 3 migration(s) pending; head = 0"]);
    expect(r.applied).toEqual([]);
    expect(fake.calls.filter((c) => c.script.length > 0)).toEqual([]);
  });

  it("finishes a ledger holding 1..k with the carried files, then the files after the baseline", async () => {
    const b = assembleSchema(baseline(3), [carried(2), carried(3)]).baseline;
    const c4 = describeFile("0004_c.sql", c3.bytes);
    const fake = fakePsql({ ledger: [`1 ${sum(1)}`] });
    const out: string[] = [];
    const r = await migrate({ psql: fake.run, files: [c4], baseline: b, out: (l) => out.push(l), err: () => undefined });
    expect(r.exitCode, out.join("\n")).toBe(0);
    expect(r.applied).toEqual(["0002_m2.sql", "0003_m3.sql", "0004_c.sql"]);
    expect(fake.calls.filter((c) => c.script.length > 0)[0]?.script.toString()).toBe(`begin;\noriginal 2\n${ledgerInsert(carried(2))}\ncommit;\n`);
    expect(fake.ledger).toEqual([`1 ${sum(1)}`, `2 ${sum(2)}`, `3 ${sum(3)}`, `4 ${c4.checksum}`]);
    expect(out.at(-1)).toBe("✓ 3 migration(s) applied; head = 4");
  });

  it("dry-run names the carried files it would apply", async () => {
    const b = assembleSchema(baseline(2), [carried(2)]).baseline;
    const fake = fakePsql({ ledger: [`1 ${sum(1)}`] });
    const out: string[] = [];
    await migrate({ psql: fake.run, files: after, baseline: b, dryRun: true, out: (l) => out.push(l), err: () => undefined });
    expect(out).toEqual(["would apply 0002_m2.sql", "would apply 0003_c.sql", "✓ 2 migration(s) pending; head = 1"]);
  });

  it("on an empty ledger the baseline stands for the carried files: they are not applied again", async () => {
    const b = assembleSchema(baseline(2), [carried(2)]).baseline;
    const fake = fakePsql();
    const r = await migrate({ psql: fake.run, files: after, baseline: b, ...quiet });
    expect(r.applied).toEqual(["0002_baseline.sql", "0003_c.sql"]);
  });

  const carriedRefusals: [string, string[], number[]][] = [
    ["a ledger with a hole the carried files would paper over", [`1 ${sum(1)}`, `3 ${sum(3)}`], [2, 3]],
    ["a ledger with a hole below the carried files", [`2 ${sum(2)}`], [3]],
    ["a missing version no file carries", [`1 ${sum(1)}`], [3]],
  ];
  for (const [name, ledger, carry] of carriedRefusals) {
    it(`refuses ${name}, sending nothing`, async () => {
      const b = assembleSchema(baseline(3), carry.map(carried)).baseline;
      const fake = fakePsql({ ledger });
      const r = await migrate({ psql: fake.run, files: [], baseline: b, ...quiet });
      expect(r.exitCode).toBe(1);
      expect(r.message).toContain("the baseline only starts an EMPTY database, and this image carries no file for every missing version");
      expect(fake.calls.filter((c) => c.script.length > 0)).toEqual([]);
    });
  }

  const refusals: [string, string[], string][] = [
    ["a partial ledger", [`1 ${sum(1)}`], "✗ the ledger holds 1 of the baseline's 2 versions (first missing: 0002_m2.sql)"],
    ["a ledger holding only versions above it", [`3 ${sum(3)}`], "✗ the ledger holds versions above the baseline but none of 1..2"],
    ["a checksum that differs from ledger.tsv", [`1 ${sum(1)}`, `2 ${sum(9)}`], "✗ 0002_m2.sql is applied with a different checksum than the baseline's ledger.tsv"],
  ];
  for (const [name, ledger, message] of refusals) {
    it(`refuses ${name}, sending nothing`, async () => {
      const fake = fakePsql({ ledger });
      const err: string[] = [];
      const r = await migrate({ psql: fake.run, files: after, baseline: baseline(2), out: () => undefined, err: (l) => err.push(l) });
      expect(r.exitCode).toBe(1);
      expect(r.message).toContain(message);
      expect(fake.calls.filter((c) => c.script.length > 0)).toEqual([]);
    });
  }

  it("a failed baseline stops before the files after it", async () => {
    const fake = fakePsql({ fail: (s) => (s.startsWith("begin;\ncreate table a") ? { code: 3, stdout: "", stderr: "ERROR:  boom\n" } : null) });
    const r = await migrate({ psql: fake.run, files: after, baseline: baseline(2), ...quiet });
    expect([r.exitCode, r.applied]).toEqual([3, []]);
    expect(r.message).toBe("✗ 0002_baseline.sql failed (not a lock timeout): not retried");
  });
});

describe("compareLedgerExport", () => {
  const exp = (rows: string[], header = true): string => `${header ? "version\tname\tchecksum\n" : ""}${rows.join("\n")}\n`;
  const r3 = (n: number): string => `${String(n)}\t${String(n).padStart(4, "0")}_m${String(n)}.sql\t${sum(n)}`;

  it("passes an export holding every version with equal names and checksums, tab or psql's | separator, header or not", () => {
    const b = baseline(2);
    expect(compareLedgerExport(b, exp([r3(1), r3(2)]))).toEqual({ exitCode: 0, lines: ["✓ the export holds all 2 versions of ledger.tsv with equal names and checksums"] });
    expect(compareLedgerExport(b, exp([r3(1), r3(2), r3(3)].map((l) => l.replace(/\t/g, "|")), false)).lines).toEqual([
      "✓ the export holds all 2 versions of ledger.tsv with equal names and checksums; 1 version(s) after the baseline, not compared",
    ]);
  });

  it("names every difference: missing, renamed, another checksum", () => {
    const r = compareLedgerExport(baseline(3), exp([`1\t0001_other.sql\t${sum(1)}`, `3\t0003_m3.sql\t${sum(9)}`]));
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([
      "  ✗ version 1: the export names 0001_other.sql, ledger.tsv 0001_m1.sql",
      "  ✗ version 2 (0002_m2.sql): not in the export",
      `  ✗ version 3 (0003_m3.sql): the checksum differs (export ${sum(9).slice(0, 12)}…, ledger.tsv ${sum(3).slice(0, 12)}…)`,
      "✗ 3 of the baseline's 3 versions differ from the export",
    ]);
  });

  it.each([
    ["an empty export", "", "holds no ledger row"],
    ["two columns", "1\t0001_a.sql\n", "line 1: expected version, name, checksum"],
    ["a bad checksum", `1\t0001_a.sql\t${"X".repeat(64)}\n`, "64 lower-case hex"],
    ["a duplicate", `${r3(1)}\n${r3(1)}\n`, "version 1 twice"],
    ["a version that is not a positive whole number", `0\t0001_a.sql\t${"a".repeat(64)}\n`, "positive whole number"],
  ])("refuses %s as unreadable", (_n, text, msg) => {
    expect(() => compareLedgerExport(baseline(1), text)).toThrow(msg);
  });
});
