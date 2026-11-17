/**
 * domains.train_board_departures and contract.train_board (0314): the DB
 * Timetables boards the live ingestor fetches on a person's ask, appended by
 * the live ingestor's own role viafrei_live_ingestor (0315) and read by the API's reader
 * as each station's newest fetch.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { DomainDb } from "./domain-db.js";

const url = process.env["TEST_DATABASE_URL"];
const required = process.env["VF_REQUIRE_DB"] === "1";

if (url === undefined && required) {
  describe("domains.train_board_departures", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the train board test did not run");
    });
  });
}

const T = "domains.train_board_departures";

/** Runs fn as role in a transaction that is rolled back. */
async function as<R>(pool: pg.Pool, role: string, fn: (c: pg.PoolClient) => Promise<R>): Promise<R> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    return await fn(c);
  } finally {
    await c.query("rollback");
    c.release();
  }
}

/** The SQLSTATE fn fails with, or "ok". */
async function state(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}

const insert = `insert into ${T} (eva, observed_at, planned_at, changed_at, platform, changed_platform, category, train_number, line, destination, cancelled)
  values ($1, $2, $3, $4, $5, $6, 'ICE', '571', 'ICE 571', 'München Hbf', $7)`;

describe.skipIf(url === undefined)("domains.train_board_departures", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "train_board");

  beforeAll(async () => {
    await t.make([]);
    await t.pool.query("select public.ensure_daily_partitions()");
  }, 180_000);

  afterAll(async () => {
    await t.drop();
  });

  it("is a tick table on the daily schedule: partitioned by day on observed_at, with a retention row and no default partition", async () => {
    const r = await t.pool.query<{ key: string; keep: number; archive: boolean; parts: number; dflt: number }>(
      `select pg_get_partkeydef('${T}'::regclass) as key,
              (select keep_days from public.partition_retention where schema_name = 'domains' and table_name = 'train_board_departures') as keep,
              (select archive from public.partition_retention where schema_name = 'domains' and table_name = 'train_board_departures') as archive,
              (select count(*)::int from pg_inherits i where i.inhparent = '${T}'::regclass) as parts,
              (select count(*)::int from pg_inherits i join pg_class c on c.oid = i.inhrelid
                where i.inhparent = '${T}'::regclass and pg_get_expr(c.relpartbound, c.oid) = 'DEFAULT') as dflt`,
    );
    expect(r.rows[0]).toMatchObject({ key: "RANGE (observed_at)", keep: 14, archive: false, dflt: 0 });
    expect(r.rows[0]?.parts).toBeGreaterThan(0);
  });

  it("viafrei_live_ingestor (0315) appends a board of db_timetables with the fixed attribution and licence, and can read, change or remove none; api_access and viafrei_ingestor append none", async () => {
    const now = new Date();
    const at = new Date(now.getTime() - 5_000).toISOString();
    const planned = new Date(now.getTime() + 600_000).toISOString();
    const api = await as(t.pool, "api_access", (c) => state(() => c.query(insert, ["8011160", at, planned, null, "5", null, false])));
    expect(api).toBe("42501");
    const ing = await as(t.pool, "viafrei_ingestor", (c) => state(() => c.query(insert, ["8011160", at, planned, null, "5", null, false])));
    expect(ing).toBe("42501");
    const out = await as(t.pool, "viafrei_live_ingestor", async (c) => {
      await c.query(insert, ["8011160", at, planned, null, "5", null, false]);
      const other = await state(() => c.query("savepoint s").then(() => c.query(`insert into ${T} (eva, observed_at, planned_at, source_id) values ('8011160', $1, $1, 'other_source')`, [at])));
      await c.query("rollback to savepoint s");
      const read = await state(() => c.query("savepoint r").then(() => c.query(`select count(*) from ${T}`)));
      await c.query("rollback to savepoint r");
      const upd = await state(() => c.query("savepoint u").then(() => c.query(`update ${T} set cancelled = true`)));
      await c.query("rollback to savepoint u");
      const del = await state(() => c.query("savepoint d").then(() => c.query(`delete from ${T}`)));
      await c.query("rollback to savepoint d");
      await c.query("reset role");
      const row = await c.query<{ source_id: string; attribution: string; licence: string }>(`select source_id, attribution, licence from ${T} where eva = '8011160'`);
      return { other, read, upd, del, row: row.rows };
    });
    expect(out.row).toEqual([{ source_id: "db_timetables", attribution: "Fahrplandaten: Deutsche Bahn AG, DB API Marketplace, CC BY 4.0, bearbeitet", licence: "CC BY 4.0" }]);
    // the source check or the insert policy refuses another source; no read, update or delete grant
    expect(["23514", "42501"]).toContain(out.other);
    expect([out.read, out.upd, out.del]).toEqual(["42501", "42501", "42501"]);
  });

  it("contract.train_board serves each station's newest fetch only, to api_reader", async () => {
    const now = Date.now();
    const iso = (ms: number): string => new Date(now + ms).toISOString();
    const rows = await t.planted(async (c) => {
      await c.query(insert, ["8000105", iso(-120_000), iso(600_000), null, "5", null, false]);
      await c.query(insert, ["8000105", iso(-10_000), iso(600_000), iso(900_000), "5", "7", false]);
      await c.query(insert, ["8000105", iso(-10_000), iso(1_200_000), null, "3", null, true]);
      await c.query(insert, ["8000261", iso(-60_000), iso(300_000), null, "1", null, false]);
      await c.query("set local role api_reader");
      return (
        await c.query<{ station_eva: string; n: number; changed: number; fetched: Date; source_ref: string; licence: string }>(
          `select station_eva, count(*)::int as n, count(changed_platform)::int as changed, max(fetched_at) as fetched, min(source_ref) as source_ref, min(licence) as licence
             from contract.train_board group by station_eva order by station_eva`,
        )
      ).rows;
    });
    expect(rows.map((r) => [r.station_eva, r.n, r.changed, r.source_ref, r.licence])).toEqual([
      ["8000105", 2, 1, "db_timetables", "CC BY 4.0"],
      ["8000261", 1, 0, "db_timetables", "CC BY 4.0"],
    ]);
    expect(rows[0]?.fetched.toISOString()).toBe(iso(-10_000));
  });
});
