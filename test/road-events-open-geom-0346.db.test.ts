/**
 * 0346: road_events_open_geom, a GiST index on road_events.geom over the open rows.
 *
 *  - the index exists, VALID, with its definition;
 *  - the open events in a box are found through it under the custom and the
 *    generic plan, and the rows are the ones the table holds;
 *  - the file run again is a no-op that applies outside a transaction; an
 *    INVALID index of its name is built again.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { describe, expect, it } from "vitest";
import { migratedSuite, reapply } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0346 road events open geom", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0346 test did not run");
    });
  });
}

const FILE = "0346_road_events_open_geom.sql";
const DEF = "CREATE INDEX road_events_open_geom ON public.road_events USING gist (geom) WHERE ((closed_at IS NULL) AND (deleted_at IS NULL))";
const OPEN_IN_BOX = `select e.id from road_events e
  where e.geom && st_makeenvelope((select $1::float8)::float8, (select $2::float8)::float8, (select $3::float8)::float8, (select $4::float8)::float8, 4326)
    and e.deleted_at is null and e.closed_at is null
  order by e.id`;

describe.skipIf(url === undefined)("0346 road events open geom", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "geo0346");
  const q = async <T = Record<string, unknown>>(sql: string): Promise<T[]> => (await t.pool.query(sql)).rows as T[];

  it("holds road_events_open_geom VALID with its definition", async () => {
    expect(await q("select pg_get_indexdef(indexrelid) def, indisvalid valid from pg_index where indexrelid = 'public.road_events_open_geom'::regclass")).toEqual([{ def: DEF, valid: true }]);
  });

  it("finds the open events in a box through it, custom and generic plan, and only those", async () => {
    const c = await t.pool.connect();
    try {
      await c.query("begin");
      await c.query("alter table road_events disable trigger road_events_land");
      // A grid of 20 000 events over Germany, three in four closed or deleted, as on production.
      await c.query(`insert into road_events (feed_key, source_id, publication_id, version, payload, geom, closed_at, deleted_at)
        select 'f', 's', 'g' || g, 1, '{}'::jsonb, st_setsrid(st_makepoint(6 + (g % 100) * 0.09, 47.5 + (g / 100) * 0.035), 4326),
               case when g % 4 in (1, 2) then now() end, case when g % 4 = 3 then now() end
          from generate_series(0, 19999) g`);
      await c.query("analyze road_events");
      const want = (await c.query<{ id: string }>(`select e.id from road_events e
          where st_x(e.geom) between 7.4 and 7.9 and st_y(e.geom) between 51.3 and 51.7 and e.closed_at is null and e.deleted_at is null and e.publication_id like 'g%' order by e.id`)).rows;
      expect(want.length).toBeGreaterThan(0);
      await c.query(`prepare t_box(float8, float8, float8, float8) as ${OPEN_IN_BOX}`);
      for (const mode of ["force_custom_plan", "force_generic_plan"]) {
        await c.query(`set local plan_cache_mode = ${mode}`);
        const plan = (await c.query<{ "QUERY PLAN": string }>("explain (costs off) execute t_box(7.4, 51.3, 7.9, 51.7)")).rows.map((x) => x["QUERY PLAN"]).join("\n");
        expect(plan, mode).toMatch(/Index Scan using road_events_open_geom on road_events e|Bitmap Index Scan on road_events_open_geom/);
        expect((await c.query<{ id: string }>("execute t_box(7.4, 51.3, 7.9, 51.7)")).rows, mode).toEqual(want);
      }
    } finally {
      await c.query("rollback");
      c.release();
    }
  }, 120_000);

  it("run again keeps everything, outside a transaction; an INVALID index of its name is built again", async () => {
    const oid = async (): Promise<number> => (await q<{ o: number }>("select 'public.road_events_open_geom'::regclass::oid o"))[0]!.o;
    const first = await oid();
    await reapply(t, service(), FILE);
    expect(await oid()).toBe(first);
    await t.pool.query("drop index public.road_events_open_geom");
    // A concurrent build that fails part-way leaves an INVALID index of the name: its predicate divides by zero on one row.
    await t.pool.query("insert into road_events (feed_key, source_id, publication_id, version, payload) values ('f', 's', 'boom', 1, '{}')");
    await expect(t.pool.query("create index concurrently road_events_open_geom on public.road_events using gist (geom) where closed_at is null and deleted_at is null and 1 / (case when publication_id = 'boom' then 0 else 1 end) = 1")).rejects.toThrow(/division by zero/);
    expect((await t.pool.query("select 1 from pg_index where indexrelid = to_regclass('public.road_events_open_geom') and not indisvalid")).rowCount).toBe(1);
    await reapply(t, service(), FILE);
    expect(await q("select pg_get_indexdef(indexrelid) def, indisvalid valid from pg_index where indexrelid = 'public.road_events_open_geom'::regclass")).toEqual([{ def: DEF, valid: true }]);
  });
});
