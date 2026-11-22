/**
 * 0327's index for the digest's VBN Connect read: present, valid and of the
 * definition production was given by hand first; the read's near step (the
 * live Connect stops, gtfs_feed_key 2, within 150 m of a DELFI stop) planned
 * through it on a seeded table, not through stops_geom_gist over every feed;
 * and the file a no-op on a database that already holds it (production's
 * case), while an INVALID leftover is rebuilt.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { migratedSuite, reapply } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];
const required = process.env["VF_REQUIRE_DB"] === "1";

if (url === undefined && required) {
  describe("0327 stops_geom_connect", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the stops_geom_connect test did not run");
    });
  });
}

const NAME = "stops_geom_connect";
const DEF = "CREATE INDEX stops_geom_connect ON public.stops USING gist (geom) WHERE ((gtfs_feed_key = 2) AND (deleted_at IS NULL))";
const FILE = "0327_stops_geom_connect.sql";

describe.skipIf(url === undefined)("0327 stops_geom_connect", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "geomconnect");

  type Ix = { name: string; def: string; valid: boolean; ready: boolean; oid: number };
  const index = async (): Promise<Ix[]> =>
    (
      await t.pool.query<Ix>(
        `select c.relname as name, pg_get_indexdef(i.indexrelid) as def, i.indisvalid as valid, i.indisready as ready, i.indexrelid::int as oid
           from pg_index i join pg_class c on c.oid = i.indexrelid
          where c.relnamespace = 'public'::regnamespace and c.relname = $1`,
        [NAME],
      )
    ).rows;

  it("has the index, valid, with the definition production was given", async () => {
    expect((await index()).map(({ name, def, valid, ready }) => ({ name, def, valid, ready }))).toEqual([{ name: NAME, def: DEF, valid: true, ready: true }]);
  });

  const plan = async (c: pg.PoolClient, sql: string): Promise<string> =>
    (await c.query<{ "QUERY PLAN": string }>(`explain ${sql}`)).rows.map((x) => x["QUERY PLAN"]).join("\n");

  it("plans the live Connect stops within 150 m of a DELFI stop through stops_geom_connect, not the all-feeds GiST", async () => {
    await t.planted(async (c) => {
      // Five feeds over the same area, feed 2 (Connect) a small share, a part of it deleted.
      await c.query(
        `insert into public.stops (gtfs_feed_key, id, name, geom, deleted_at)
         select case when g % 10 = 0 then 2 when g % 5 = 1 then 6 else 1 + (g % 5) end, 's' || g, 'Stop ' || g,
                st_setsrid(st_makepoint(8.7 + (g % 150) * 0.002, 53.0 + (g / 150) * 0.002), 4326)::geography,
                case when g % 30 = 0 then now() end
           from generate_series(1, 30000) g`,
      );
      await c.query("analyze public.stops");
      const p = await plan(
        c,
        `select ds.id as dstop, cs.id as cstop, st_distance(cs.geom, ds.geom) as d
           from public.stops_live ds
           join public.stops_live cs on cs.gtfs_feed_key = 2::smallint and st_dwithin(cs.geom, ds.geom, 150::float8)
          where ds.gtfs_feed_key = 1::smallint and ds.id = 's1005'`,
      );
      expect(p).toMatch(/Index Scan using stops_geom_connect|Bitmap Index Scan on stops_geom_connect/);
      // The DELFI stop itself may come by its key; the Connect side is never the all-feeds GiST, nor that ANDed with every feed-2 key.
      expect(p).not.toMatch(/stops_geom_gist|BitmapAnd|Bitmap Index Scan on stops_id_prefix|Seq Scan/);
    });
  });

  it("is a no-op over the index production already holds, and rebuilds an INVALID leftover", async () => {
    const s = service();
    const before = await index();
    // Production's case: the index made by hand, the ledger without 327.
    await reapply(t, s, FILE);
    expect(await index()).toEqual(before);
    // A failed concurrent build leaves an INVALID index: the file drops it and builds it again.
    await t.pool.query(`update pg_index set indisvalid = false where indexrelid = 'public.${NAME}'::regclass`);
    await reapply(t, s, FILE);
    const after = await index();
    expect(after.map(({ name, def, valid }) => ({ name, def, valid }))).toEqual(before.map(({ name, def, valid }) => ({ name, def, valid })));
    expect(after[0]?.oid).not.toBe(before[0]?.oid);
  });
  it("refuses an index of another definition under the name, naming it, and leaves it in place", async () => {
    const s = service();
    await t.pool.query(`drop index public.${NAME}`);
    await t.pool.query(`create index ${NAME} on public.stops using gist (geom) where gtfs_feed_key = 2`);
    const other = await index();
    await t.pool.query("delete from schema_migrations where version = 327");
    const run = await s.migrate("cli");
    expect(run.ok).toBe(false);
    expect(run.lines.join("\n")).toMatch(/stops_geom_connect exists with another definition/);
    expect(await index()).toEqual(other);
    await t.pool.query(`drop index public.${NAME}`);
    await reapply(t, s, FILE);
    expect((await index()).map((x) => x.def)).toEqual([DEF]);
  });
});
