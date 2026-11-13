import { describe, expect, it, vi } from "vitest";
import { describeFile } from "../src/migrations/files.js";
import { CREATE_LEDGER, EXIT_TEMPFAIL, ledgerInsert, migrate, noTransactionScripts, parseLedger, wrappedScript } from "../src/migrations/migrate.js";
import { fakePsql } from "./helpers.js";

const A = "create table a(id int);\n";
const B = "-- no-transaction: create index concurrently cannot run in a transaction\ncreate index concurrently if not exists a_id on a(id);\n";
const C = "create table c(id int);\n-- a trailing comment\n";

describe("the scripts sent to psql", () => {
  it("wrap a normal file as begin; <bytes>\\n<insert>\\ncommit;", () => {
    const f = describeFile("0001_a.sql", Buffer.from(A));
    expect(wrappedScript(f).toString()).toBe(`begin;\n${A}\n${ledgerInsert(f)}\ncommit;\n`);
    expect(ledgerInsert(f)).toBe(`insert into schema_migrations(version,name,checksum) values (1,'0001_a.sql','${f.checksum}');`);
  });

  it("send a no-transaction file alone and its ledger row after it", () => {
    const f = describeFile("0002_b.sql", Buffer.from(B));
    const [body, ledger] = noTransactionScripts(f);
    expect(body.toString()).toBe(`${B}\n`);
    expect(ledger).toBe(`${ledgerInsert(f)}\n`);
  });

  it("keep the file's bytes untouched, CRLF and all", () => {
    const raw = Buffer.from("create table x(id int);\r\n");
    const f = describeFile("0001_x.sql", raw);
    expect(wrappedScript(f).subarray(7, 7 + raw.length).equals(raw)).toBe(true);
  });
});

describe("migrate", () => {
  const files = [describeFile("0001_a.sql", Buffer.from(A)), describeFile("0002_b.sql", Buffer.from(B)), describeFile("0003_c.sql", Buffer.from(C))];

  it("creates the ledger, applies the pending files in order and reports the head", async () => {
    const fake = fakePsql();
    const out: string[] = [];
    const r = await migrate({ psql: fake.run, files, out: (l) => out.push(l), err: () => undefined });
    expect(fake.calls[0]?.args).toEqual(["-c", CREATE_LEDGER]);
    expect(r.applied).toEqual(["0001_a.sql", "0002_b.sql", "0003_c.sql"]);
    expect(r.head).toBe(3);
    expect(out).toContain("applying 0002_b.sql (no transaction — see the file's -- no-transaction: note)");
    expect(out.at(-1)).toBe("✓ 3 migration(s) applied; head = 3");
  });

  it("skips what is applied with an equal checksum", async () => {
    const fake = fakePsql({ ledger: [`1 ${files[0]?.checksum ?? ""}`] });
    const r = await migrate({ psql: fake.run, files, out: () => undefined, err: () => undefined });
    expect(r.applied).toEqual(["0002_b.sql", "0003_c.sql"]);
  });

  it("stops at an applied file whose checksum differs, after applying the pending files before it", async () => {
    const fake = fakePsql({ ledger: [`2 ${"0".repeat(64)}`] });
    const err: string[] = [];
    const r = await migrate({ psql: fake.run, files, out: () => undefined, err: (l) => err.push(l) });
    expect(r.exitCode).toBe(1);
    expect(r.applied).toEqual(["0001_a.sql"]);
    expect(err.at(-1)).toBe("✗ 0002_b.sql is applied with a different checksum — never edit an applied migration");
  });

  it("dry-run applies nothing and lists what it would", async () => {
    const fake = fakePsql();
    const out: string[] = [];
    const r = await migrate({ psql: fake.run, files, dryRun: true, out: (l) => out.push(l), err: () => undefined });
    expect(fake.ledger).toEqual([]);
    expect(out.slice(0, 3)).toEqual(["would apply 0001_a.sql", "would apply 0002_b.sql", "would apply 0003_c.sql"]);
    expect(r.message).toBe("✓ 3 migration(s) pending; head = 0");
  });

  it("retries a lock timeout (55P03) and applies the file on a later attempt", async () => {
    let failures = 1;
    const fake = fakePsql({ fail: (s) => (s.startsWith("begin;") && failures-- > 0 ? { code: 3, stdout: "", stderr: "ERROR:  55P03: canceling statement due to lock timeout\n" } : null) });
    const slept: number[] = [];
    const r = await migrate({ psql: fake.run, files: files.slice(0, 1), lockAttempts: 4, lockPauseS: 20, sleep: (ms) => (slept.push(ms), Promise.resolve()), out: () => undefined, err: () => undefined });
    expect(r.exitCode).toBe(0);
    expect(slept).toEqual([20_000]);
  });

  it("gives up with 75 when every attempt times out on a lock", async () => {
    const fake = fakePsql({ fail: (s) => (s.startsWith("begin;") ? { code: 3, stdout: "", stderr: "ERROR:  55P03: lock timeout\n" } : null) });
    const r = await migrate({ psql: fake.run, files: files.slice(0, 1), lockAttempts: 2, sleep: () => Promise.resolve(), out: () => undefined, err: () => undefined });
    expect(r.exitCode).toBe(EXIT_TEMPFAIL);
    expect(fake.ledger).toEqual([]);
  });

  it("fails at once, with psql's code, on any other error", async () => {
    const fake = fakePsql({ fail: (s) => (s.startsWith("begin;") ? { code: 3, stdout: "", stderr: "ERROR:  42P07: relation exists\n" } : null) });
    let slept = 0;
    const r = await migrate({ psql: fake.run, files: files.slice(0, 1), lockAttempts: 4, sleep: () => (slept++, Promise.resolve()), out: () => undefined, err: () => undefined });
    expect(r.exitCode).toBe(3);
    expect(slept).toBe(0);
  });

  it("does not record a no-transaction file whose body failed", async () => {
    const fake = fakePsql({ fail: (s) => (s.startsWith("-- no-transaction") ? { code: 3, stdout: "", stderr: "ERROR:  XX000: boom\n" } : null) });
    const r = await migrate({ psql: fake.run, files: files.slice(1, 2), out: () => undefined, err: () => undefined });
    expect(r.exitCode).toBe(3);
    expect(fake.calls.some((c) => c.script.toString().startsWith("insert into"))).toBe(false);
  });

  it("refuses a lock-attempt count below one", async () => {
    await expect(migrate({ psql: fakePsql().run, files, lockAttempts: 0 })).rejects.toThrow(/whole number >= 1/);
  });

  it("refuses a ledger line it cannot read", () => {
    expect(parseLedger("1 abc\n2 def\n")).toEqual([
      { version: 1, checksum: "abc" },
      { version: 2, checksum: "def" },
    ]);
    expect(() => parseLedger("banner from ssh\n")).toThrow(/not '<version> <checksum>'/);
  });
});

describe("migrate's edges", () => {
  const f1 = [describeFile("0001_a.sql", Buffer.from(A))];
  it("waits with a real timer between lock attempts when no sleep is given", async () => {
    let failures = 1;
    const fake = fakePsql({ fail: (s) => (s.startsWith("begin;") && failures-- > 0 ? { code: 3, stdout: "", stderr: "ERROR:  55P03: lock timeout\n" } : null) });
    const r = await migrate({ psql: fake.run, files: f1, lockAttempts: 2, lockPauseS: 0, out: () => undefined, err: () => undefined });
    expect(r.exitCode).toBe(0);
  });

  it("writes to stdout and stderr when no out and err are given", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const o = vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true));
    const e = vi.spyOn(process.stderr, "write").mockImplementation((c: string | Uint8Array) => (err.push(String(c)), true));
    try {
      await migrate({ psql: fakePsql().run, files: f1 });
      await migrate({ psql: fakePsql({ fail: (s, n) => (n === 1 ? { code: 2, stdout: "", stderr: "" } : null) }).run, files: f1 });
    } finally {
      o.mockRestore();
      e.mockRestore();
    }
    expect(out.join("")).toMatch(/1 migration\(s\) applied; head = 1/);
    expect(err.join("")).toBe("✗ schema_migrations could not be created or read: (no message)\n");
  });

  it("refuses a negative lock pause", async () => {
    await expect(migrate({ psql: fakePsql().run, files: f1, lockPauseS: -1 })).rejects.toThrow(/whole number of seconds/);
  });

  it("stops with 1 and psql's first line when the ledger cannot be read", async () => {
    const lines: string[] = [];
    const fake = fakePsql({ fail: (_s, n) => (n === 2 ? { code: 2, stdout: "", stderr: "\nFATAL:  terminating connection\nmore\n" } : null) });
    const r = await migrate({ psql: fake.run, files: f1, out: () => undefined, err: (l) => lines.push(l) });
    expect([r.exitCode, r.head, r.before]).toEqual([1, null, null]);
    expect(lines).toEqual(["✗ schema_migrations could not be read (psql exit 2): FATAL:  terminating connection"]);
  });
});
