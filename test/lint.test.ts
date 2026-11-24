import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { fsIo, gitBlobId, likeMatches, lint, LOCK_RULE_FROM, lockingStatement, type LintIo } from "../src/lint/check-migrations.js";
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
  ["a refresh concurrently, which runs inside a transaction, needs no marker", { "0001_a.sql": ok(1, "create function f() returns void language sql as $$ refresh materialized view concurrently v $$;\n") }, []],
  ["a refresh concurrently does not hide another concurrently", { "0001_a.sql": ok(1, "refresh materialized view concurrently v;\ncreate index concurrently if not exists i on a(id);\n") }, ["0001_a.sql: runs something 'concurrently'"]],
  ["concurrently in a comment only", { "0001_a.sql": ok(1, "-- this is not run concurrently\n") }, []],
  ["a marker past line 20", { "0001_a.sql": ok(1, `${"-- x\n".repeat(20)}-- no-transaction: late\ncreate index concurrently if not exists i on a(id);\n`) }, ["0001_a.sql: has a '-- no-transaction:' note, but not as a line of its own within the first 20 lines"]],
  ["an indented marker", { "0001_a.sql": ok(1, " -- no-transaction: indented\ncreate index concurrently if not exists i on a(id);\n") }, ["0001_a.sql: runs something 'concurrently'"]],
  ["a marker on a file that needs nothing, but idempotent", { "0001_a.sql": ok(1, "-- no-transaction: why\ncreate table if not exists z(id int);\n") }, ["0001_a.sql: is marked '-- no-transaction:' but runs nothing that needs it"]],
  ["a marked file that is not idempotent", { "0001_a.sql": ok(1, "-- no-transaction: why\ncreate index concurrently i on a(id);\n") }, ["0001_a.sql: is marked '-- no-transaction:' and so can half-apply"]],
  ["a marked drop with if exists is idempotent", { "0001_a.sql": ok(1, "-- no-transaction: why\ndrop index concurrently if exists i;\n") }, []],
  ["a marked drop without if exists is not", { "0001_a.sql": ok(1, "-- no-transaction: why\ndrop index concurrently i;\n") }, ["0001_a.sql: is marked '-- no-transaction:' and so can half-apply"]],
  ["a bare drop is not made idempotent by a rollback comment that says if not exists", { "0001_a.sql": ok(1, "-- no-transaction: why\n-- rollback: create index concurrently if not exists i on t (c);\ndrop index concurrently i;\n") }, ["0001_a.sql: is marked '-- no-transaction:' and so can half-apply"]],
  ["one idempotent drop does not cover a bare one", { "0001_a.sql": ok(1, "-- no-transaction: why\ndrop index concurrently if exists a;\ndrop index concurrently b;\n") }, ["0001_a.sql: is marked '-- no-transaction:' and so can half-apply"]],
  ["a bare build beside an idempotent drop is not idempotent", { "0001_a.sql": ok(1, "-- no-transaction: why\ndrop index concurrently if exists a;\ncreate index concurrently b on t (c);\n") }, ["0001_a.sql: is marked '-- no-transaction:' and so can half-apply"]],
  ["a drop built as text for \\gexec is not a statement of the file", { "0001_a.sql": ok(1, "-- no-transaction: why\nselect 'drop index concurrently ' || 'x'\n\\gexec\ncreate index concurrently if not exists b on t (c);\n") }, []],
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
      "  ✗ db/baseline/notes.md: only ledger.tsv, aliases.tsv and one NNNN_baseline.sql belong in db/baseline",
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

describe("rule 6: a file that locks a table it did not create sets lock_timeout first", () => {
  const io = (body: string, num = 305): LintIo => ({
    list: (d) => (d === "migrations" ? [`${String(num).padStart(4, "0")}_x.sql`] : ["ledger.tsv", `${String(num - 1).padStart(4, "0")}_baseline.sql`]),
    read: (d, n) => Buffer.from(d === "baseline" ? (n === "ledger.tsv" ? TSV(num - 1) : "select 1;\n") : `${body}-- rollback: delete from schema_migrations where version = ${String(num)};\n`),
    base: () => ({ kind: "absent", note: "no 'origin' remote" }),
    baseBlob: () => null,
  });
  const fails = (body: string, num?: number): string[] => lint(io(body, num)).lines.filter((l) => l.startsWith("  ✗ "));

  it.each([
    ["a plain index on a table it did not create", "create index t_a on public.t (a);\n"],
    ["a unique index", "CREATE UNIQUE INDEX t_a ON t USING btree (a);\n"],
    ["an alter table", "alter table only domains.road_works add column x int;\n"],
    ["the bound set only after the statement", "create index t_a on t (a);\nset local lock_timeout = '5s';\n"],
    ["the bound in a comment only", "-- set local lock_timeout = '5s';\ncreate index t_a on t (a);\n"],
    ["a session-wide bound (set, not set local)", "set lock_timeout = '5s';\ncreate index t_a on t (a);\n"],
    ["a create trigger on a table it did not create", "create trigger t_aud after insert on public.t for each row execute function f();\n"],
    ["a create or replace trigger", "CREATE OR REPLACE TRIGGER t_aud AFTER UPDATE OF a ON t FOR EACH ROW EXECUTE FUNCTION f();\n"],
    ["a drop trigger", "drop trigger if exists t_aud on domains.t;\n"],
    ["a plain drop index", "drop index public.t_a;\n"],
    ["a plain reindex", "reindex table public.t;\n"],
    ["a lock table", "lock table domains.a, domains.b in share mode;\n"],
    ["a truncate", "truncate table public.t;\n"],
    ["a create or replace view", "create or replace view public.v as select 1;\n"],
    ["a dynamic alter in a DO block", "do $$ begin execute format('alter table %I.%I add column x int', 'public', 't'); end $$;\n"],
  ])("refuses %s", (_what, body) => {
    expect(fails(body)).toEqual([expect.stringMatching(/locks a table this file did not create, with no 'set local lock_timeout' before it/)]);
  });

  it.each([
    ["the bound before the statement", "set local lock_timeout = '5s';\ncreate index t_a on t (a);\nalter table t add column b int;\n"],
    ["a table the file creates", "create table domains.n (a int);\ncreate index n_a on domains.n (a);\nalter table domains.n add column b int;\n"],
    ["a table it creates, named without its schema", "create table n (a int);\ncreate index n_a on public.n (a);\n"],
    ["no locking statement", "create view v as select 1;\n"],
    ["a trigger on a table the file creates", "create table n (a int);\ncreate trigger n_aud after insert on n for each row execute function f();\ndrop trigger n_aud on public.n;\n"],
    ["a truncate of a table the file creates", "create table n (a int);\ntruncate n;\n"],
    ["a column named lock or truncate", "create view v as select t.a as lock from t;\ncreate view w as select t.b as truncate from t;\n"],
    ["the words in a literal", "comment on table public.t is 'a truncated file; lock the door';\n"],
    ["a dynamic alter inside a function body, which runs when called", "create or replace function f() returns void language plpgsql as $f$ begin execute format('alter table %I attach partition %I', 'a', 'b'); end $f$;\n"],
  ])("passes %s", (_what, body) => {
    expect(fails(body)).toEqual([]);
  });

  it("judges a file from LOCK_RULE_FROM on and not before", () => {
    expect(LOCK_RULE_FROM).toBe(294);
    expect(fails("create index t_a on t (a);\n", 294)).toHaveLength(1);
    expect(fails("create index t_a on t (a);\n", 293)).toEqual([]);
  });

  it("names the first locking statement; an index on a table the file created does not count, nor a concurrent build", () => {
    expect(lockingStatement("create table a (x int);\ncreate index a_x on a (x);\nalter table b add y int;\n")?.statement).toBe("alter table b");
    expect(lockingStatement("create index concurrently if not exists a_x on a (x);\n")).toBeNull();
    expect(lockingStatement("drop index concurrently if exists public.t_a;\nreindex index concurrently public.t_b;\n")).toBeNull();
    expect(lockingStatement("select 'alter table x';\ndo $$ begin execute format('alter table %I add y int', 't'); end $$;\n")?.statement).toBe("execute format('alter table");
  });
});
