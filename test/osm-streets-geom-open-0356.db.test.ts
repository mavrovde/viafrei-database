/**
 * 0356: osm_streets_geom_open, the unused partial GiST index on the open
 * streets' geom, dropped.
 *
 *  - at head the index is gone, and the table keeps its other indexes (the
 *    geom_lo bands, the open-land close, the keys);
 *  - the file bounds the drop's lock wait: lock_timeout set before the drop,
 *    reset at its end;
 *  - over a database that holds the index (the rollback's definition, which is
 *    the baseline's) the file drops it, outside a transaction;
 *  - run again where the index is gone, the file is a no-op.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migratedSuite, reapply } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0356 drop osm_streets_geom_open", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0356 test did not run");
    });
  });
}

const FILE = "0356_drop_osm_streets_geom_open.sql";
/** The baseline's definition (0293_baseline.sql), as pg_get_indexdef prints it. */
const DEF = "CREATE INDEX osm_streets_geom_open ON public.osm_streets USING gist (geom) WHERE (closed_at IS NULL)";
const KEPT = ["osm_streets_lo_secondary", "osm_streets_lo_trunk", "osm_streets_open_land", "osm_streets_osm_type_osm_id_key", "osm_streets_pkey"];

describe.skipIf(url === undefined)("0356 drop osm_streets_geom_open", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "osm0356");

  /** The indexes of public.osm_streets, by name. */
  const indexes = async (): Promise<string[]> =>
    (
      await t.pool.query<{ n: string }>(
        "select c.relname as n from pg_index x join pg_class c on c.oid = x.indexrelid where x.indrelid = 'public.osm_streets'::regclass order by 1",
      )
    ).rows.map((r) => r.n);

  it("drops osm_streets_geom_open and keeps every other index of osm_streets", async () => {
    expect(await indexes()).toEqual(KEPT);
  });

  it("bounds the drop's lock wait: lock_timeout set before the drop, reset at the end", () => {
    const sql = readFileSync(new URL(`../db/migrations/${FILE}`, import.meta.url), "utf8").replace(/--[^\n]*/g, "");
    const set = sql.indexOf("set lock_timeout = '5s';");
    expect(set).toBeGreaterThan(-1);
    expect(set).toBeLessThan(sql.indexOf("drop index concurrently if exists public.osm_streets_geom_open;"));
    expect(sql.trimEnd().endsWith("reset lock_timeout;")).toBe(true);
  });

  it("drops the index from a database that holds it (production's case), outside a transaction", async () => {
    const rollback = readFileSync(new URL(`../db/migrations/${FILE}`, import.meta.url), "utf8")
      .split("\n")
      .find((l) => l.startsWith("--   create index concurrently"));
    expect(rollback).toBeDefined();
    await t.pool.query((rollback ?? "").replace(/^--\s+/, ""));
    const held = await t.pool.query<{ d: string }>("select pg_get_indexdef('public.osm_streets_geom_open'::regclass) as d");
    expect(held.rows[0]?.d).toBe(DEF);
    await reapply(t, service(), FILE);
    expect(await indexes()).toEqual(KEPT);
  });

  it("run again where the index is already gone is a no-op", async () => {
    await reapply(t, service(), FILE);
    expect(await indexes()).toEqual(KEPT);
  });
});
