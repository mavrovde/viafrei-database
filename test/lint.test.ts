import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { fsIo, gitBlobId, likeMatches, lint, type LintIo } from "../src/lint/check-migrations.js";
import { sha256Hex } from "../src/migrations/files.js";
import { plantTree } from "./helpers.js";

const OK1 = "create table a(id int);\n-- rollback: drop table a; delete from schema_migrations where version = 1;\n";
const ok = (n: number, extra = ""): string => `${extra}create table t${String(n)}(id int);\n-- rollback: drop table t${String(n)}; delete from schema_migrations where version = ${String(n)};\n`;

let done: (() => void) | null = null;
afterEach(() => {
  done?.();
  done = null;
});

/**
 * Each case: the planted tree, and the failure lines the lint must print, each
 * named by a fragment unique to its rule. Asserting the LINES and not only the
 * exit code matters where two rules fire on one file: without it a case passes
 * on the other rule while the one it names is dead (rule 3 vs 5c, 9 vs 10).
 */
const cases: [string, Record<string, string>, readonly string[]][] = [
  ["a clean pair", { "0001_a.sql": OK1, "0002_b.sql": ok(2) }, []],
  ["a gap", { "0001_a.sql": OK1, "0003_c.sql": ok(3) }, ["0003_c.sql: expected number 0002"]],
  ["an upper-case slug start", { "0001_a.sql": OK1, "0002_B.sql": ok(2) }, ["0002_B.sql: must match NNNN_slug.sql"]],
  ["no slug character at all", { "0001_.sql": OK1 }, ["0001_.sql: must match NNNN_slug.sql"]],
  ["a hyphen and upper case after the first slug character (the glob's *)", { "0001_a-B.sql": OK1 }, []],
  ["no rollback note", { "0001_a.sql": "create table a(id int);\n" }, ["0001_a.sql: missing a '-- rollback:' note", "0001_a.sql: the rollback note never says how to delete its own ledger row"]],
  ["a rollback naming another version", { "0001_a.sql": OK1, "0002_b.sql": ok(2).replace("version = 2", "version = 1") }, ["0002_b.sql: a rollback note says 'schema_migrations where version = 1' but this file is 2"]],
  ["a zero-padded version", { "0001_a.sql": OK1, "0002_b.sql": ok(2).replace("version = 2", "version = 0002") }, []],
  ["an irreversible note", { "0001_a.sql": "create table a(id int);\n-- rollback: irreversible: drops a, take a dump\n" }, []],
  ["a name-like line matching this file", { "0001_a.sql": "create table a(id int);\n-- rollback: delete from schema_migrations where name like '0001_%';\n" }, []],
  ["a name-like line matching another file", { "0001_a.sql": "create table a(id int);\n-- rollback: delete from schema_migrations where name like '0002_%';\n" }, ["0001_a.sql: a rollback note says \"schema_migrations where name like '0002_%'\""]],
  ["a note that never names its ledger row", { "0001_a.sql": "create table a(id int);\n-- rollback: drop table a;\n" }, ["0001_a.sql: the rollback note never says how to delete its own ledger row"]],
  ["a grandfathered file", { "0001_a.sql": OK1, "0002_b.sql": ok(2), "0003_fuel_watch_asked.sql": "x;\n-- rollback: drop it\n" }, []],
  ["no trailing newline", { "0001_a.sql": OK1.trimEnd() }, ["0001_a.sql: does not end in a newline"]],
  ["concurrently without the marker", { "0001_a.sql": ok(1, "create index concurrently if not exists i on a(id);\n") }, ["0001_a.sql: runs something 'concurrently'"]],
  ["concurrently with the marker", { "0001_a.sql": ok(1, "-- no-transaction: concurrently\ncreate index concurrently if not exists i on a(id);\n") }, []],
  ["concurrently in a comment only", { "0001_a.sql": ok(1, "-- this is not run concurrently\n") }, []],
  ["a marker past line 20", { "0001_a.sql": ok(1, `${"-- x\n".repeat(20)}-- no-transaction: late\ncreate index concurrently if not exists i on a(id);\n`) }, ["0001_a.sql: has a '-- no-transaction:' note, but not as a line of its own within the first 20 lines"]],
  ["an indented marker", { "0001_a.sql": ok(1, " -- no-transaction: indented\ncreate index concurrently if not exists i on a(id);\n") }, ["0001_a.sql: runs something 'concurrently'"]],
  ["a marker on a file that needs nothing, but idempotent", { "0001_a.sql": ok(1, "-- no-transaction: why\ncreate table if not exists z(id int);\n") }, ["0001_a.sql: is marked '-- no-transaction:' but runs nothing that needs it"]],
  ["a marked file that is not idempotent", { "0001_a.sql": ok(1, "-- no-transaction: why\ncreate index concurrently i on a(id);\n") }, ["0001_a.sql: is marked '-- no-transaction:' and so can half-apply"]],
  ["a version note on the next line is not a ledger line (grep is line-based)", { "0001_a.sql": "x;\n-- rollback: delete from schema_migrations where\n-- version = 7;\n" }, ["0001_a.sql: the rollback note never says how to delete its own ledger row"]],
];

describe("the lint over planted trees", () => {
  for (const [name, files, failures] of cases) {
    it(`${name}: ${failures.length === 0 ? "passes" : `fails on ${String(failures.length)} line(s)`}`, () => {
      const t = plantTree(files);
      done = t.done;
      const r = lint(fsIo(t.root));
      const got = r.lines.filter((l) => l.startsWith("  ✗ "));
      expect(r.exitCode, r.lines.join("\n")).toBe(failures.length === 0 ? 0 : 1);
      expect(got.length, got.join("\n")).toBe(failures.length);
      failures.forEach((f, i) => expect(got[i], got.join("\n")).toContain(f));
    });
  }
});

const TSV = (n: number): string => `version\tname\tchecksum\n${Array.from({ length: n }, (_, i) => `${String(i + 1)}\t${String(i + 1).padStart(4, "0")}_m${String(i + 1)}.sql\t${"a".repeat(64)}\n`).join("")}`;

describe("rule B: the baseline", () => {
  const planted = (baseline: Record<string, string> | null, migrations: Record<string, string> | null): LintIo => ({
    list: (d) => {
      const m = d === "baseline" ? baseline : migrations;
      return m === null ? null : Object.keys(m);
    },
    read: (d, n) => Buffer.from((d === "baseline" ? baseline : migrations)?.[n] ?? ""),
    base: () => ({ kind: "absent", note: "no 'origin' remote" }),
    baseBlob: () => null,
  });
  const fails = (io: LintIo): string[] => lint(io).lines.filter((l) => l.startsWith("  ✗ "));

  it("a baseline and nothing after it passes, and says so", () => {
    const r = lint(planted({ "ledger.tsv": TSV(3), "0003_baseline.sql": "create table a(id int);\n" }, null));
    expect(r.exitCode, r.lines.join("\n")).toBe(0);
    expect(r.lines.at(-1)).toBe("✓ migrations ok (baseline 1..3, no file after it yet; rule 4 NOT applicable: no 'origin' remote)");
  });

  it("files continue at the baseline's head + 1", () => {
    const r = lint(planted({ "ledger.tsv": TSV(3), "0003_baseline.sql": "x;\n" }, { "0004_a.sql": ok(4) }));
    expect(r.exitCode, r.lines.join("\n")).toBe(0);
    expect(r.lines.at(-1)).toContain("baseline 1..3 + 1 file(s)");
  });

  it("a file the baseline already stands for is refused, naming the next number", () => {
    expect(fails(planted({ "ledger.tsv": TSV(3), "0003_baseline.sql": "x;\n" }, { "0003_a.sql": ok(3) }))).toEqual([
      "  ✗ 0003_a.sql: the baseline already stands for versions 1..3 and ledger.tsv names version 3 0003_m3.sql; migrations after it start at 0004",
    ]);
  });

  /** A ledger whose last row is `name` with the checksum of `bytes`: the file that row carries. */
  const carriedTsv = (name: string, bytes: string): string => `${TSV(2)}3\t${name}\t${sha256Hex(Buffer.from(bytes))}\n`;

  it("a CARRIED file (the head's own name and bytes) passes, is linted like any file, and the next is head + 1", () => {
    const r = lint(planted({ "ledger.tsv": carriedTsv("0003_m3.sql", ok(3)), "0003_baseline.sql": "x;\n" }, { "0003_m3.sql": ok(3), "0004_a.sql": ok(4) }));
    expect(r.exitCode, r.lines.join("\n")).toBe(0);
    expect(r.lines.at(-1)).toContain("baseline 1..3 (1 carried) + 1 file(s)");
    expect(fails(planted({ "ledger.tsv": carriedTsv("0003_m3.sql", "x;"), "0003_baseline.sql": "x;\n" }, { "0003_m3.sql": "x;" }))).toEqual([
      "  ✗ 0003_m3.sql: missing a '-- rollback:' note (how to undo, or 'irreversible: …')",
      expect.stringContaining("0003_m3.sql: the rollback note never says how to delete its own ledger row"),
      expect.stringContaining("0003_m3.sql: does not end in a newline"),
    ]);
  });

  it("a carried file whose bytes differ from ledger.tsv's checksum is refused", () => {
    expect(fails(planted({ "ledger.tsv": carriedTsv("0003_m3.sql", ok(3)), "0003_baseline.sql": "x;\n" }, { "0003_m3.sql": ok(3, "-- edited\n") }))).toEqual([
      "  ✗ 0003_m3.sql: the baseline carries version 3 with another checksum in ledger.tsv — a carried file is the exact file the baseline was generated from; never edit it",
    ]);
  });

  it("a gap after the baseline is refused", () => {
    expect(fails(planted({ "ledger.tsv": TSV(3), "0003_baseline.sql": "x;\n" }, { "0005_a.sql": ok(5) }))[0]).toContain("0005_a.sql: expected number 0004");
  });

  it("a baseline file numbered off the ledger's head is refused", () => {
    expect(fails(planted({ "ledger.tsv": TSV(3), "0002_baseline.sql": "x;\n" }, null))).toEqual(["  ✗ db/baseline/0002_baseline.sql: must be numbered 0003, the last version in ledger.tsv"]);
  });

  it("a missing ledger, a second baseline file and a stray file are each named", () => {
    expect(fails(planted({ "0003_baseline.sql": "x;\n", "0004_baseline.sql": "y;\n", "notes.md": "" }, null))).toEqual([
      "  ✗ db/baseline/notes.md: only ledger.tsv and one NNNN_baseline.sql belong in db/baseline",
      "  ✗ db/baseline: ledger.tsv is missing",
      "  ✗ db/baseline: expected exactly one NNNN_baseline.sql, found 2",
    ]);
  });

  it("a ledger with a gap is refused with its line", () => {
    const bad = TSV(3).replace("2\t0002_m2.sql", "5\t0005_m2.sql");
    expect(fails(planted({ "ledger.tsv": bad, "0003_baseline.sql": "x;\n" }, null))[0]).toContain("db/baseline/ledger.tsv line 3: expected version 2");
  });

  it("rule 4 freezes the baseline once it is on origin/main", () => {
    const io: LintIo = { ...planted({ "ledger.tsv": TSV(1), "0001_baseline.sql": "now;\n" }, null), base: () => ({ kind: "ok" }), baseBlob: (d, n) => (d === "baseline" && n === "0001_baseline.sql" ? gitBlobId(Buffer.from("before;\n")) : null) };
    expect(fails(io)).toEqual(["  ✗ db/baseline/0001_baseline.sql: already on origin/main and was EDITED — the baseline is frozen; write a migration after it instead"]);
  });
});

describe("rule 4", () => {
  const io = (base: LintIo["base"], baseBlob: LintIo["baseBlob"]): LintIo => ({ list: (d) => (d === "migrations" ? ["0001_a.sql"] : null), read: () => Buffer.from(OK1), base, baseBlob });

  it("an edited file already on origin/main fails", () => {
    const r = lint(io(() => ({ kind: "ok" }), () => gitBlobId(Buffer.from("old\n"))));
    expect(r.exitCode).toBe(1);
    expect(r.lines).toContain("  ✗ 0001_a.sql: already on origin/main and was EDITED — write a new migration instead");
  });

  it("an unchanged one passes, and the tail says how many were compared", () => {
    const r = lint(io(() => ({ kind: "ok" }), () => gitBlobId(Buffer.from(OK1))));
    expect(r.exitCode).toBe(0);
    expect(r.lines.at(-1)).toContain("rule 4 compared 1 against origin/main");
  });

  it("an origin with no origin/main is a refusal, never a skip", () => {
    const r = lint(io(() => ({ kind: "refuse" }), () => null));
    expect(r.exitCode).toBe(1);
    expect(r.lines[0]).toContain("does not resolve");
  });

  it("no origin remote is announced and the rule is reported not applicable", () => {
    const r = lint(io(() => ({ kind: "absent", note: "no 'origin' remote" }), () => null));
    expect(r.lines[0]).toBe("note: no 'origin' remote");
    expect(r.lines.at(-1)).toContain("rule 4 NOT applicable");
  });
});

describe("gitBlobId", () => {
  it("is the id git itself gives the bytes", () => {
    expect(gitBlobId(Buffer.from("a\n"))).toBe(execFileSync("git", ["hash-object", "--stdin"], { input: "a\n", encoding: "utf8" }).trim());
  });
});

describe("likeMatches", () => {
  it("treats % as any run of characters and nothing else as special", () => {
    expect(likeMatches("0001_%", "0001_a.sql")).toBe(true);
    expect(likeMatches("0001_a.sql", "0001_a.sql")).toBe(true);
    expect(likeMatches("0001_a.sql", "0001_aXsql")).toBe(false);
  });
});
