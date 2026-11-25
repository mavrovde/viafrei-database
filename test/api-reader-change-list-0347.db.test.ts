/**
 * 0347: api_reader reads the thirty-one base tables behind the answers of the MCP
 * change list viafrei-api carries, each by name.
 *
 *  - SELECT on each of the thirty-one public relations, each present; nothing
 *    more on them;
 *  - api_reader reads every one as itself;
 *  - the owner-rights *_live views over them stay unreadable to it, and so do
 *    the partitions of the two day-partitioned tick tables;
 *  - the file applied again, its ledger row deleted, is a no-op.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { API_READER_0347 } from "./api-reader-base.js";
import { refusal } from "./domain-db.js";
import { migratedSuite } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0347 api_reader change-list grants", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0347 test did not run");
    });
  });
}

const FILE = "0347_api_reader_change_list_grants.sql";
const PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
/** The owner-rights views over the granted tables: the API reads the tables, never these. */
const FORBIDDEN: readonly string[] = [
  "public.bfrk_stops_live",
  "public.bw_detours_live",
  "public.connect_transit_delays_live",
  "public.delfi_siri_et_calls_live",
  "public.fuel_price_latest_live",
  "public.hh_roadworks_live",
  "public.los_now_live",
  "public.motorway_summary_live",
  "public.mvv_bus_load_live",
  "public.opendata_roadworks_live",
  "public.parking_forecast_profiles_live",
  "public.road_event_locations_live",
  "public.station_accessibility_live",
  "public.traffic_count_now_live",
];
const PARTITIONED = ["public.delfi_siri_et_calls", "public.connect_transit_delays"];
const EXPECTED = API_READER_0347.map((n) => `${n} SELECT`).sort((a, b) => a.localeCompare(b));

describe.skipIf(url === undefined)("0347 api_reader change-list grants", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "changelist0347");

  const as = async <R>(fn: (c: pg.PoolClient) => Promise<R>): Promise<R> =>
    t.planted(async (c) => {
      await c.query("set local role api_reader");
      return fn(c);
    });

  /** api_reader's privileges on each relation, as one sorted list. */
  const held = async (): Promise<string[]> => {
    const r = await t.pool.query<{ s: string }>(
      `select x.n || ' ' || p as s from unnest($1::text[]) x(n) cross join unnest($2::text[]) p where has_table_privilege('api_reader', x.n, p)`,
      [API_READER_0347, PRIVS],
    );
    return r.rows.map((x) => x.s).sort((a, b) => a.localeCompare(b));
  };

  it("names thirty-one relations, every one present and none named twice", async () => {
    expect(API_READER_0347).toHaveLength(31);
    expect(new Set(API_READER_0347).size).toBe(31);
    const r = await t.pool.query<{ n: string }>("select x.n from unnest($1::text[]) x(n) where to_regclass(x.n) is null", [API_READER_0347]);
    expect(r.rows).toEqual([]);
  });

  it("api_reader holds SELECT on each relation, and nothing more on them", async () => {
    expect(await held()).toEqual(EXPECTED);
  });

  it("api_reader reads every one of them, as itself", async () => {
    const failed: string[] = [];
    for (const n of API_READER_0347) {
      try {
        await as((c) => c.query(`select 1 from ${n} limit 0`));
      } catch (e) {
        failed.push(`${n}: ${(e as Error).message}`);
      }
    }
    expect(failed).toEqual([]);
  });

  it("api_reader still cannot read the owner-rights views over them, nor a partition of the tick tables", async () => {
    const missing = await t.pool.query<{ n: string }>("select x.n from unnest($1::text[]) x(n) where to_regclass(x.n) is null", [FORBIDDEN]);
    expect(missing.rows).toEqual([]);
    for (const n of FORBIDDEN) {
      expect(await refusal(as((c) => c.query(`select 1 from ${n} limit 0`))), n).toMatchObject({ code: "42501" });
    }
    const parts = await t.pool.query<{ p: string }>(
      "select inhrelid::regclass::text as p from pg_inherits where inhparent = any($1::regclass[])",
      [PARTITIONED],
    );
    expect(parts.rows.length).toBeGreaterThan(0);
    for (const { p } of parts.rows) expect(await refusal(as((c) => c.query(`select 1 from ${p} limit 0`))), p).toMatchObject({ code: "42501" });
  });

  it("applied again, its ledger row deleted, applies that file alone and changes nothing", async () => {
    const acl = async (): Promise<{ n: string; a: string | null }[]> =>
      (
        await t.pool.query<{ n: string; a: string | null }>(
          "select x.n, (select relacl::text from pg_class where oid = x.n::regclass) as a from unnest($1::text[]) x(n) order by 1",
          [API_READER_0347],
        )
      ).rows;
    const before = await acl();
    await t.pool.query("delete from schema_migrations where version = 347");
    const run = await service().migrate("cli");
    expect(run.ok, run.lines.join("\n")).toBe(true);
    expect(run.lines.filter((l) => l.startsWith("applying")).map((l) => l.split(" ")[1])).toEqual([FILE]);
    expect(await acl()).toEqual(before);
    expect(await held()).toEqual(EXPECTED);
  });
});
