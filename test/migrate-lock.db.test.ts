/**
 * The lock bound, by behaviour (#31 item 6, main's migration-lock-timeout
 * test; lint rule 6 in src/lint/check-migrations.ts): a migration that indexes
 * a table another session holds open for writing (ROW EXCLUSIVE, a writer's
 * lock) and sets `set local lock_timeout` gives up with 55P03 inside the bound
 * instead of queueing, and `migrate` retries it:
 *
 *   the writer lets go   a later attempt applies the file, each failed one is a
 *                        warning, nothing is applied twice;
 *   the writer holds on  every attempt fails, the run stops with 75, nothing of
 *                        the file and nothing after it is applied.
 */
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { describeFile } from "../src/migrations/files.js";
import { EXIT_TEMPFAIL, migrate } from "../src/migrations/migrate.js";
import { psqlRunner } from "../src/psql.js";

const base = process.env["TEST_DATABASE_URL"] ?? "";
const name = `test_vfdb_lock_${String(process.pid)}`;
const admin = new pg.Pool({ connectionString: base, max: 1 });
const own = new URL(base);
own.pathname = `/${name}`;

const files = (): ReturnType<typeof describeFile>[] => [
  describeFile("0001_written.sql", Buffer.from("create table zz_written (id int);\n")),
  describeFile("0002_index.sql", Buffer.from("set local lock_timeout = '300ms';\ncreate index zz_written_id on zz_written (id);\n")),
  describeFile("0003_after.sql", Buffer.from("create table zz_after (id int);\n")),
];

beforeEach(async () => {
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
});
afterAll(async () => {
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

/** Applies 0001, then holds zz_written in ROW EXCLUSIVE while migrate runs; with `letGo` the writer commits once the first 55P03 is reported. */
async function underWriter(attempts: number, letGo: boolean): Promise<{ r: Awaited<ReturnType<typeof migrate>>; err: string[]; ms: number; ledger: number[]; index: boolean; after: boolean }> {
  const psql = psqlRunner({ databaseUrl: own.toString() });
  const first = await migrate({ psql, files: files().slice(0, 1), out: () => undefined, err: () => undefined });
  expect(first.exitCode).toBe(0);
  const holder = new pg.Client({ connectionString: own.toString() });
  await holder.connect();
  try {
    await holder.query("begin");
    await holder.query("lock table zz_written in row exclusive mode");
    const err: string[] = [];
    let released = false;
    const onErr = (l: string): void => {
      err.push(l);
      if (letGo && !released && l.includes("55P03")) {
        released = true;
        void holder.query("rollback");
      }
    };
    const t0 = Date.now();
    const r = await migrate({ psql, files: files(), out: onErr, err: onErr, lockAttempts: attempts, lockPauseS: 0 });
    const ms = Date.now() - t0;
    await holder.query("rollback").catch(() => undefined);
    const c = new pg.Client({ connectionString: own.toString() });
    await c.connect();
    try {
      const ledger = (await c.query<{ v: number }>("select version as v from schema_migrations order by 1")).rows.map((x) => x.v);
      const objs = (await c.query<{ i: string | null; a: string | null }>("select to_regclass('zz_written_id')::text as i, to_regclass('zz_after')::text as a")).rows[0];
      return { r, err, ms, ledger, index: objs?.i != null, after: objs?.a != null };
    } finally {
      await c.end();
    }
  } finally {
    await holder.end();
  }
}

describe("a migration that indexes a written table gives up on a held lock and is retried", () => {
  it("the writer lets go: an attempt after it applies the file and the files after it, each failed attempt a 55P03 warning", async () => {
    const x = await underWriter(30, true);
    expect(x.r.exitCode, x.err.join("\n")).toBe(0);
    expect(x.ledger).toEqual([1, 2, 3]);
    expect(x.index && x.after).toBe(true);
    const warned = x.err.filter((l) => /0002_index\.sql: lock timeout \(SQLSTATE 55P03\) on attempt \d+\/30/.test(l));
    expect(warned.length).toBeGreaterThanOrEqual(1);
    expect(warned.length).toBeLessThan(5);
  }, 30_000);

  it("the writer holds on: every attempt fails inside the bound, the run stops with 75 and applies nothing of the file or after it", async () => {
    const x = await underWriter(3, false);
    expect(x.r.exitCode).toBe(EXIT_TEMPFAIL);
    expect(x.ledger).toEqual([1]);
    expect(x.index || x.after).toBe(false);
    expect(x.err.at(-1)).toMatch(/0002_index\.sql: lock timeout \(SQLSTATE 55P03\) on all 3 attempt\(s\)/);
    // Three bounded waits of 300 ms, not a queue: well under the statement timeout a queued CREATE INDEX would reach.
    expect(x.ms).toBeGreaterThanOrEqual(900);
    expect(x.ms).toBeLessThan(10_000);
  }, 30_000);
});
