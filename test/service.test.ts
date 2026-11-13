import type pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { describeFile } from "../src/migrations/files.js";
import type { PsqlResult } from "../src/psql.js";
import { DatabaseService, MIGRATE_LOCK_KEY } from "../src/service.js";
import { fakePsql } from "./helpers.js";

const files = [describeFile("0001_a.sql", Buffer.from("create table a(id int);\n")), describeFile("0002_b.sql", Buffer.from("create table b(id int);\n"))];
const log = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** A pool whose ledger is the fake psql's, and whose advisory lock can be held by "someone else". */
function fakePool(ledger: string[], o: { lockHeld?: boolean; ledgerFails?: boolean; unlockFails?: boolean } = {}): { pool: pg.Pool; lockCalls: unknown[][] } {
  const lockCalls: unknown[][] = [];
  const query = (sql: string): Promise<{ rows: unknown[] }> => {
    if (o.ledgerFails === true) return Promise.reject(new Error("connection refused"));
    if (sql.includes("to_regclass('schema_migrations')")) return Promise.resolve({ rows: [{ t: ledger.length > 0 ? "schema_migrations" : null }] });
    if (sql.startsWith("select version, checksum from schema_migrations"))
      return Promise.resolve({ rows: ledger.map((l) => ({ version: Number(l.split(" ")[0]), checksum: l.split(" ")[1] })) });
    throw new Error(`unexpected query ${sql}`);
  };
  const client = {
    query: (sql: string, params?: unknown[]) => {
      lockCalls.push([sql, ...(params ?? [])]);
      if (o.unlockFails === true && sql.includes("pg_advisory_unlock")) return Promise.reject(new Error("connection lost"));
      return Promise.resolve({ rows: [{ ok: o.lockHeld !== true }] });
    },
    release: () => undefined,
  };
  return { pool: { query, connect: () => Promise.resolve(client), end: () => Promise.resolve() } as unknown as pg.Pool, lockCalls };
}

let svc: DatabaseService | null = null;
afterEach(async () => {
  await svc?.close();
  svc = null;
});

function make(o: { fail?: (s: string, args: readonly string[]) => PsqlResult | null; lockHeld?: boolean; ledgerFails?: boolean; unlockFails?: boolean; env?: Record<string, string> } = {}): { svc: DatabaseService; ledger: string[]; lockCalls: unknown[][] } {
  const ledger: string[] = [];
  const psql = fakePsql({ ledger: [] });
  const run = (script: string | Buffer, args: readonly string[] = []): Promise<PsqlResult> => {
    const forced = o.fail?.(script.toString(), args);
    if (forced) return Promise.resolve(forced);
    return psql.run(script, args).then((r) => {
      ledger.splice(0, ledger.length, ...psql.ledger);
      return r;
    });
  };
  const p = fakePool(ledger, o);
  svc = new DatabaseService({ config: loadConfig({ DATABASE_URL: "postgresql://u@h/db", ...o.env }, "serve"), log, pool: p.pool, psql: run, files });
  return { svc, ledger, lockCalls: p.lockCalls };
}

const partitionsFail = (_s: string, args: readonly string[]): PsqlResult | null => (args.some((a) => a.startsWith("select ensure_daily_partitions")) ? { code: 3, stdout: "", stderr: "ERROR: no function\n" } : null);

describe("DatabaseService", () => {
  it("is not ready before boot, and ready after boot from an empty database (roles skipped without a secret dir)", async () => {
    const m = make();
    expect(m.svc.snapshot().readiness.ready).toBe(false);
    await m.svc.boot(10);
    const s = m.svc.snapshot();
    expect(s.readiness).toEqual({ ready: true, detail: "at head 2" });
    expect(m.ledger.map((l) => l.split(" ")[0])).toEqual(["1", "2"]);
    expect(s.lastMigrate?.ok).toBe(true);
    expect(s.lastAction).toBeNull();
    expect(m.lockCalls.map((c) => c[0])).toEqual(["select pg_try_advisory_lock($1::bigint) as ok", "select pg_advisory_unlock($1::bigint)"]);
    expect(m.lockCalls[0]?.[1]).toBe(MIGRATE_LOCK_KEY);
  });

  it("stays not ready at head when the partitions step fails", async () => {
    const m = make({ fail: partitionsFail });
    await m.svc.boot(60_000);
    const s = m.svc.snapshot();
    expect(s.schemaReadiness.ready).toBe(true);
    expect(s.readiness.ready).toBe(false);
  });

  it("stays not ready when a required role password cannot be applied", async () => {
    const m = make({ env: { VF_DB_ROLE_DIR: "/nonexistent-secret-dir" } });
    await m.svc.boot(60_000);
    expect(m.svc.snapshot().readiness.ready).toBe(false);
    expect(m.svc.snapshot().roles?.ok).toBe(false);
  });

  it("retries a failed boot migrate and becomes ready when the cause is gone", async () => {
    let failing = true;
    const m = make({ fail: (s) => (failing && s.startsWith("begin;") ? { code: 3, stdout: "", stderr: "ERROR: 42P01: boom\n" } : null) });
    await m.svc.boot(20);
    expect(m.svc.snapshot().readiness.ready).toBe(false);
    failing = false;
    await new Promise((r) => setTimeout(r, 120));
    expect(m.svc.snapshot().readiness.ready).toBe(true);
  });

  it("applies nothing when another migrate holds the advisory lock, and says 75", async () => {
    const m = make({ lockHeld: true });
    const r = await m.svc.migrate("cli");
    expect([r.ok, r.exitCode]).toEqual([false, 75]);
    expect(m.ledger).toEqual([]);
  });

  it("runs one action at a time; a second is refused with 75", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const m = make();
    const slow = (m.svc as unknown as { psql: (s: string, a: string[]) => Promise<PsqlResult> }).psql;
    (m.svc as unknown as { psql: unknown }).psql = async (s: string, a: string[]): Promise<PsqlResult> => {
      await gate;
      return slow(s, a);
    };
    const first = m.svc.migrate("owner");
    const second = await m.svc.check("owner");
    expect([second.ok, second.exitCode, second.lines[0]]).toEqual([false, 75, "✗ migrate is running — one action at a time"]);
    release();
    expect((await first).ok).toBe(true);
  });

  it("reports the schema as unknown, never ready, when the ledger cannot be read", async () => {
    const m = make({ ledgerFails: true });
    await m.svc.refresh();
    expect(m.svc.snapshot().schema).toBeNull();
    expect(m.svc.snapshot().readiness.ready).toBe(false);
  });

  it("a migrate whose advisory unlock fails still reports the migrate's own result", async () => {
    const m = make({ unlockFails: true });
    const r = await m.svc.migrate("cli");
    expect(r.ok).toBe(true);
    expect(m.lockCalls.map((c) => c[0])).toContain("select pg_advisory_unlock($1::bigint)");
  });

  it("analyze runs as an exclusive action and names the table it was asked for", async () => {
    const m = make();
    const r = await m.svc.analyze("nothing_here", "owner");
    expect([r.action, r.subject, r.ok, r.lines[0]]).toEqual(["analyze", "nothing_here", false, "✗ no table, partitioned table or materialized view named nothing_here"]);
    expect(m.svc.snapshot().lastAction).toBe(r);
  });

  it("an action that throws becomes a failed record, not a rejected promise", async () => {
    const m = make();
    (m.svc.pool as unknown as { connect: () => Promise<never> }).connect = () => Promise.reject(new Error("connection refused"));
    const r = await m.svc.analyze("t", "cli");
    expect([r.ok, r.exitCode, r.lines]).toEqual([false, 1, ["✗ analyze failed: connection refused"]]);
  });

  it.each<[string, Parameters<typeof make>[0]]>([
    ["the partitions step", { fail: partitionsFail }],
    ["a required role password", { env: { VF_DB_ROLE_DIR: "/nonexistent-secret-dir" } }],
  ])("retries the boot sequence on a timer when %s fails", async (_n, o) => {
    const m = make(o);
    let migrates = 0;
    const real = m.svc.migrate.bind(m.svc);
    m.svc.migrate = (t, d) => ((migrates += 1), real(t, d));
    await m.svc.boot(5);
    await vi.waitFor(() => expect(migrates).toBeGreaterThanOrEqual(2), { timeout: 1000, interval: 5 });
    expect(m.svc.snapshot().readiness.ready).toBe(false);
  });

  it("schedule rechecks the ledger and, once partitions have run, ensures them on their interval", async () => {
    vi.useFakeTimers();
    try {
      const m = make({ env: { VF_DB_RECHECK_S: "5", VF_DB_PARTITIONS_EVERY_H: "1" } });
      const seen: string[] = [];
      const refresh = m.svc.refresh.bind(m.svc);
      m.svc.refresh = () => (seen.push("refresh"), refresh());
      const ensure = m.svc.ensurePartitions.bind(m.svc);
      m.svc.ensurePartitions = (t, d) => (seen.push(`partitions ${t}`), ensure(t, d));
      m.svc.schedule();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(seen).toEqual(["refresh"]);
      // Before boot has run the partitions step, the schedule does not run it.
      await vi.advanceTimersByTimeAsync(3_600_000 - 5_000);
      expect(seen).not.toContain("partitions schedule");
      await m.svc.ensurePartitions("boot");
      seen.length = 0;
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(seen).toContain("partitions schedule");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failing daily ensure clears readiness, and the next one that succeeds restores it", async () => {
    vi.useFakeTimers();
    try {
      let failing = false;
      const m = make({ fail: (s, a) => (failing ? partitionsFail(s, a) : null), env: { VF_DB_PARTITIONS_EVERY_H: "1" } });
      await m.svc.boot(60_000);
      expect(m.svc.snapshot().readiness.ready).toBe(true);
      m.svc.schedule();
      failing = true;
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(m.svc.snapshot().readiness).toEqual({ ready: false, detail: "partitions ensure failed" });
      failing = false;
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(m.svc.snapshot().readiness.ready).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an owner's ensure after boot moves readiness too; one before boot does not", async () => {
    let failing = true;
    const m = make({ fail: (s, a) => (failing ? partitionsFail(s, a) : null) });
    await m.svc.ensurePartitions("owner");
    expect(m.svc.snapshot().readiness.detail).not.toBe("partitions ensure failed");
    await m.svc.boot(60_000);
    expect(m.svc.snapshot().readiness.detail).toBe("partitions ensure failed");
    failing = false;
    await m.svc.ensurePartitions("owner");
    // The partitions step now holds; boot stopped before the roles, which the next boot attempt applies.
    expect(m.svc.snapshot().readiness.detail).toBe("role passwords not applied yet");
  });
});
