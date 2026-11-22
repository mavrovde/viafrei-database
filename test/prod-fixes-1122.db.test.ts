/**
 * 0323 and 0324: the two changes production was given by hand on 2026-11-22
 * (the manual database round), made the schema's:
 *
 *   0323  gazetteer_places_stada_station_geom, a partial GiST index on the
 *         open DB stations with a position, which the stops-near read's
 *         station lookup is planned through. Production built it by hand, so
 *         the file adopts a VALID index of exactly its definition and refuses
 *         anything else under the name (an INVALID leftover, another
 *         definition) with an error, never dropping it;
 *   0324  stop_times' autovacuum settings (scale factor 0.1, cost limit 1000);
 *   0325  the four unused indexes production dropped by hand, dropped here too;
 *         energy_page_keys_feed, which a read needs, is kept.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { readFileSync } from "node:fs";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { migratedSuite } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0323-0325 hand changes of 2026-11-22", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 2026-11-22 hand-changes test did not run");
    });
  });
}

const IX = "gazetteer_places_stada_station_geom";
const DEF =
  "CREATE INDEX gazetteer_places_stada_station_geom ON public.gazetteer_places USING gist (geom) WHERE ((source_id = 'db_stada'::text) AND (kind = 'station'::text) AND (closed_at IS NULL) AND (geom IS NOT NULL))";
/** Production's statement of 2026-11-22, character for character. */
const BY_HAND = `create index concurrently ${IX} on gazetteer_places using gist (geom) where source_id='db_stada' and kind='station' and closed_at is null and geom is not null`;

type Q = pg.Pool | pg.PoolClient;
type Ix = { oid: number; def: string; valid: boolean };

const indexOf = async (q: Q): Promise<Ix | null> =>
  (
    await q.query<Ix>(
      `select i.oid::int as oid, pg_get_indexdef(i.oid) as def, x.indisvalid as valid
         from pg_class i join pg_index x on x.indexrelid = i.oid
        where i.relnamespace = 'public'::regnamespace and i.relname = $1`,
      [IX],
    )
  ).rows[0] ?? null;

const relOptions = async (q: Q): Promise<string[]> =>
  (await q.query<{ o: string[] | null }>("select reloptions as o from pg_class where oid = 'public.stop_times'::regclass")).rows[0]?.o ?? [];

describe.skipIf(url === undefined)("0323-0324 hand changes of 2026-11-22", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "hand1122");

  /** Deletes 0323's ledger row and migrates: the run's lines and whether it succeeded. */
  const rerun323 = async (): Promise<{ ok: boolean; text: string; applying: string[] }> => {
    await t.pool.query("delete from schema_migrations where version = 323");
    const run = await service().migrate("cli");
    return { ok: run.ok, text: run.lines.join("\n"), applying: run.lines.filter((l) => l.startsWith("applying")) };
  };

  it("builds the index on a clean server, valid, with exactly the definition production holds", async () => {
    const ix = await indexOf(t.pool);
    expect(ix && { def: ix.def, valid: ix.valid }).toEqual({ def: DEF, valid: true });
  });

  it("plans the stops-near station lookup through the index", async () => {
    await t.planted(async (c) => {
      await c.query(
        `insert into public.gazetteer_places (kind, name, name_norm, source_id, external_id, geom)
         select 'station', 'S' || g, 's' || g, case when g % 8 = 0 then 'db_stada' else 'bkg_gvisys' end, 'x' || g,
                st_setsrid(st_makepoint(6 + (g % 900) * 0.01, 47.5 + (g % 700) * 0.01), 4326)::geography
           from generate_series(1, 40000) g`,
      );
      await c.query("analyze public.gazetteer_places");
      const plan = (
        await c.query<{ "QUERY PLAN": string }>(
          `explain select g.external_id from public.gazetteer_places g
            where g.source_id = 'db_stada' and g.kind = 'station' and g.closed_at is null and g.geom is not null
              and st_dwithin(g.geom, st_point(8.68, 50.11)::geography, 300)`,
        )
      ).rows
        .map((r) => r["QUERY PLAN"])
        .join("\n");
      expect(plan).toMatch(new RegExp(`(Index Scan|Bitmap Index Scan) (using|on) ${IX}`));
    });
  });

  it("sets stop_times' autovacuum scale factor and cost limit", async () => {
    expect([...(await relOptions(t.pool))].sort()).toEqual(["autovacuum_vacuum_cost_limit=1000", "autovacuum_vacuum_scale_factor=0.1"]);
  });

  it("is a no-op run again: the same index, not rebuilt, and 0324 again leaves the same options", async () => {
    const before = await indexOf(t.pool);
    const run = await rerun323();
    expect(run.ok, run.text).toBe(true);
    expect(run.applying).toEqual(["applying 0323_gazetteer_stada_station_geom.sql"]);
    expect(await indexOf(t.pool)).toEqual(before);
    await t.pool.query("delete from schema_migrations where version = 324");
    const again = await service().migrate("cli");
    expect(again.ok, again.lines.join("\n")).toBe(true);
    expect([...(await relOptions(t.pool))].sort()).toEqual(["autovacuum_vacuum_cost_limit=1000", "autovacuum_vacuum_scale_factor=0.1"]);
  });

  it("adopts production's hand-built index (built concurrently, its own statement) without building another", async () => {
    await t.pool.query(`drop index public.${IX}`);
    await t.pool.query(BY_HAND);
    const hand = await indexOf(t.pool);
    expect(hand?.valid).toBe(true);
    const run = await rerun323();
    expect(run.ok, run.text).toBe(true);
    expect(await indexOf(t.pool)).toEqual(hand);
  });

  it("refuses an INVALID index under the name, naming it, and leaves it in place", async () => {
    const was = await indexOf(t.pool);
    await t.pool.query("update pg_index set indisvalid = false where indexrelid = $1::oid", [was?.oid]);
    try {
      const run = await rerun323();
      expect(run.ok).toBe(false);
      expect(run.text).toMatch(/gazetteer_places_stada_station_geom exists but is INVALID/);
      expect(await indexOf(t.pool)).toEqual({ ...was, valid: false });
    } finally {
      await t.pool.query("update pg_index set indisvalid = true where indexrelid = $1::oid", [was?.oid]);
    }
    const run = await rerun323();
    expect(run.ok, run.text).toBe(true);
  });

  it("refuses an index of another definition under the name, naming both, and leaves it in place", async () => {
    await t.pool.query(`drop index public.${IX}`);
    await t.pool.query(`create index ${IX} on public.gazetteer_places using gist (geom) where source_id = 'db_stada' and closed_at is null`);
    const other = await indexOf(t.pool);
    const run = await rerun323();
    expect(run.ok).toBe(false);
    expect(run.text).toMatch(/gazetteer_places_stada_station_geom exists with another definition/);
    expect(await indexOf(t.pool)).toEqual(other);
    await t.pool.query(`drop index public.${IX}`);
    const rebuilt = await rerun323();
    expect(rebuilt.ok, rebuilt.text).toBe(true);
    expect((await indexOf(t.pool))?.def).toBe(DEF);
  });

  const DROPPED = ["charging_points_geom_gist", "road_event_locations_road", "stop_times_stop", "trips_service"];
  const present = async (names: readonly string[]): Promise<string[]> =>
    (
      await t.pool.query<{ n: string }>(
        "select relname as n from pg_class where relnamespace = 'public'::regnamespace and relkind = 'i' and relname = any($1::text[]) order by 1",
        [names],
      )
    ).rows.map((r) => r.n);

  it("0325 drops the four unused indexes and keeps energy_page_keys_feed and the stop reads' indexes", async () => {
    expect(await present(DROPPED)).toEqual([]);
    expect(await present(["energy_page_keys_feed", "stop_times_stop_arr_tod", "stop_times_stop_tod", "trips_pkey"])).toEqual([
      "energy_page_keys_feed",
      "stop_times_stop_arr_tod",
      "stop_times_stop_tod",
      "trips_pkey",
    ]);
  });

  it("0325 bounds each drop's lock wait: lock_timeout set before the first drop, reset at the end (review)", () => {
    const sql = readFileSync(new URL("../db/migrations/0325_drop_unused_indexes.sql", import.meta.url), "utf8").replace(/--[^\n]*/g, "");
    const set = sql.indexOf("set lock_timeout = '5s';");
    expect(set).toBeGreaterThan(-1);
    expect(set).toBeLessThan(sql.indexOf("drop index concurrently"));
    expect(sql.trimEnd().endsWith("reset lock_timeout;")).toBe(true);
  });

  it("0325 run again where the indexes are already gone (production) is a no-op", async () => {
    await t.pool.query("delete from schema_migrations where version = 325");
    const run = await service().migrate("cli");
    expect(run.ok, run.lines.join("\n")).toBe(true);
    expect(run.lines.filter((l) => l.startsWith("applying"))).toEqual(["applying 0325_drop_unused_indexes.sql (no transaction — see the file's -- no-transaction: note)"]);
    expect(await present(DROPPED)).toEqual([]);
  });
});
