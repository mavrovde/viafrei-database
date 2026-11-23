/**
 * 0333: the small tables every tick rewrites (feed_state, budget_state,
 * source_schedule, gbfs_systems, road_event_twins) are vacuumed and analysed
 * at their own size — a few thousand changed rows — not at the default
 * 50 rows + 10/20 % that a few-hundred-row table rewritten by every worker
 * tick reached about once a minute, rebuilding every connection's cached plan
 * that reads it (feed_checks, gbfs_stations_live, gbfs_vehicles_live).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { describe, expect, it } from "vitest";
import { migratedSuite } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0333 feed_state autovacuum", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0333 test did not run");
    });
  });
}

const WANT = [
  "autovacuum_analyze_scale_factor=0",
  "autovacuum_analyze_threshold=20000",
  "autovacuum_vacuum_scale_factor=0",
  "autovacuum_vacuum_threshold=5000",
];

describe.skipIf(url === undefined)("0333 small hot tables autovacuum", () => {
  const { t } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "fsauto");

  for (const table of ["control.feed_state", "public.gbfs_systems", "public.source_schedule"]) {
    it(`${table} is analysed after 20 000 changed rows and vacuumed after 5 000, whatever its size`, async () => {
      const r = await t.pool.query<{ o: string[] | null }>("select reloptions as o from pg_class where oid = $1::regclass", [table]);
      expect([...(r.rows[0]?.o ?? [])].sort()).toEqual(WANT);
    });
  }

  it("control.budget_state keeps its fillfactor beside the same thresholds", async () => {
    const r = await t.pool.query<{ o: string[] | null }>("select reloptions as o from pg_class where oid = 'control.budget_state'::regclass");
    expect([...(r.rows[0]?.o ?? [])].sort()).toEqual([...WANT, "fillfactor=50"].sort());
  });

  it("public.road_event_twins, insert-and-delete churn, is vacuumed after 2 000 dead or inserted rows and analysed after 20 000", async () => {
    const r = await t.pool.query<{ o: string[] | null }>("select reloptions as o from pg_class where oid = 'public.road_event_twins'::regclass");
    expect([...(r.rows[0]?.o ?? [])].sort()).toEqual([
      "autovacuum_analyze_scale_factor=0",
      "autovacuum_analyze_threshold=20000",
      "autovacuum_vacuum_insert_scale_factor=0",
      "autovacuum_vacuum_insert_threshold=2000",
      "autovacuum_vacuum_scale_factor=0",
      "autovacuum_vacuum_threshold=2000",
    ]);
  });

  it("touches no other table's options", async () => {
    const r = await t.pool.query<{ t: string; o: string[] }>(
      `select c.oid::regclass::text as t, c.reloptions as o from pg_class c
        where c.reloptions::text like '%autovacuum_analyze_threshold=20000%' order by 1`,
    );
    expect(r.rows.map((x) => x.t)).toEqual(["control.budget_state", "control.feed_state", "gbfs_systems", "road_event_twins", "source_schedule"]);
  });
});
