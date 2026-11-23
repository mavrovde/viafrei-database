/**
 * 0338: the Land of a road event, stored at write time.
 *
 *  - road_events_land and autobahn_events_land set land_code to the traffic
 *    event relation's expression on insert and on an update of geom, for points,
 *    lines, polygons, a geom far from every Gemeinde and no geom; an update of
 *    another column leaves it;
 *  - refresh_event_land fills the rows written before 0338 and, after a
 *    gazetteer change, rewrites only the rows whose Land moved; it refuses a
 *    batch below 1;
 *  - road_events_open_land exists, VALID, and answers the open events of one
 *    Land under the custom and the generic plan;
 *  - charging_points_contract_count exists, VALID, and the national energy
 *    summary's count of points per site reads it index only (no heap fetch on
 *    an all-visible heap), under the custom and the generic plan;
 *  - road_events_live and road_events_current end with land_code, keep their
 *    grants and their rows;
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
  describe("0338 event land code", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0338 test did not run");
    });
  });
}

const FILE = "0338_event_land_code.sql";
const DEF = "CREATE INDEX road_events_open_land ON public.road_events USING btree (land_code) WHERE ((closed_at IS NULL) AND (deleted_at IS NULL))";

const CHARGING_DEF =
  "CREATE INDEX charging_points_contract_count ON public.charging_points USING btree (source_feed, site_id) INCLUDE (evse_id, point_key) WHERE ((deleted_at IS NULL) AND (site_id IS NOT NULL) AND (COALESCE(confidentiality, 'noRestriction'::text) = 'noRestriction'::text))";

/** api_national_energy's charging half as viafrei-api's store prepares it (national.go): the rules of the asked feeds, the sites, the points counted per site. */
const ENERGY = `with rules as materialized (
select src.feed
from (select distinct f as feed from unnest(((select $1::text[])::text[])::text[]) f) src
left join lateral (
  select k.excluded, k.display_class, k.audience from contract_source_rules k
  where src.feed ~ k.pattern order by k.priority limit 1) k on true
where not coalesce(k.excluded, false) and coalesce(k.display_class, 'open') <> 'withhold'
  and (coalesce(k.audience, 'public') = 'public' or current_setting('viafrei_api.own_key', true) = 'on'))
select 'charging', c.source_feed, null, c.source_feed, count(*)::int, coalesce(sum(p.n), 0)::int, null, null
from charging_sites c
join rules r on r.feed = c.source_feed
left join (
  select p.source_feed, p.site_id, count(*) filter (where p.evse_id is not null or p.point_key is not null) as n
  from charging_points p
  join rules r on r.feed = p.source_feed
  where p.deleted_at is null and p.site_id is not null
    and coalesce(p.confidentiality, 'noRestriction') = 'noRestriction'
  group by 1, 2) p on p.source_feed = c.source_feed and p.site_id = c.site_id
where c.deleted_at is null and c.geom is not null and c.closed_at is null and c.source_feed = any(((select $1::text[])::text[]))
  and coalesce(c.confidentiality, 'noRestriction') = 'noRestriction' and not coalesce(c.access_private, false)
group by 2, 4
order by 1, 2, 4`;

const GAZ = `insert into public.gazetteer_places (kind, name, name_norm, admin_code, geom, source_id, external_id) values
  ('city', 'S', 's', '08111000', st_setsrid(st_makepoint(9.18, 48.78), 4326)::geography, 'bkg_gvisys', 'g1'),
  ('city', 'U', 'u', '09775139', st_setsrid(st_makepoint(10.0, 48.39), 4326)::geography, 'bkg_gvisys', 'g2'),
  ('city', 'K', 'k', '05315000', st_setsrid(st_makepoint(6.96, 50.94), 4326)::geography, 'bkg_gvisys', 'g3')`;

/** Geometries of every kind the loaders write, near each Gemeinde, between two, far from all, and none. */
const GEOMS = [
  "st_setsrid(st_makepoint(9.2, 48.79), 4326)",
  "st_setsrid(st_makepoint(10.01, 48.4), 4326)",
  "st_geomfromtext('LINESTRING(9.1 48.7, 9.3 48.8)', 4326)",
  "st_geomfromtext('POLYGON((6.9 50.9, 7.0 50.9, 7.0 51.0, 6.9 51.0, 6.9 50.9))', 4326)",
  "st_geomfromtext('MULTIPOINT((9.25 48.75), (9.3 48.75))', 4326)",
  "st_setsrid(st_makepoint(13.4, 52.5), 4326)",
  // one point near S (08), one near K (05): st_pointonsurface takes one of them,
  // K's (05); their centroid lies between them, more than 20 km from every
  // Gemeinde (none): a centroid in place of the point on the surface fails
  "st_geomfromtext('MULTIPOINT((9.19 48.79), (6.97 50.95))', 4326)",
  "null::geometry",
];
const WANT_ROAD = "public.contract_junction_land(st_pointonsurface(geom)::geometry(Point,4326)::geography)";
const WANT_AUTOBAHN = "public.contract_junction_land(st_pointonsurface(geom::geometry)::geometry(Point,4326)::geography)";

describe.skipIf(url === undefined)("0338 the Land of a road event, stored at write time", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "evland");
  const q = async <T extends object>(sql: string, args: unknown[] = []): Promise<T[]> => (await t.pool.query<T & Record<string, unknown>>(sql, args)).rows;

  const plantRoad = async (pub: string, geom: string, closed = false): Promise<void> => {
    await t.pool.query(`insert into road_events (feed_key, source_id, publication_id, version, payload, geom, closed_at)
      values ('f', 's', $1, 1, '{}'::jsonb, ${geom}, ${closed ? "now()" : "null"})`, [pub]);
  };

  it("stores the relation's expression on insert, for every geometry kind, near, far and none", async () => {
    await t.pool.query(GAZ);
    for (const [i, g] of GEOMS.entries()) await plantRoad(`r${String(i)}`, g);
    // autobahn_events.geom is a geography(Point): points only.
    await t.pool.query(
      `insert into autobahn_events (observed_at, road, kind, ext_id, title, source, geom)
       select now(), 'A8', 'roadworks', 'a' || i, 'A8 | X', 'autobahn', g::geometry::geography from unnest($1::text[]) with ordinality u(g, i)`,
      [["SRID=4326;POINT(9.2 48.79)", "SRID=4326;POINT(10.01 48.4)", "SRID=4326;POINT(6.97 50.95)", "SRID=4326;POINT(13.4 52.5)", null]],
    );
    const road = await q<{ n: string; differ: string; lands: string[] }>(
      `select count(*)::text n, count(*) filter (where land_code is distinct from ${WANT_ROAD})::text differ,
              array_agg(coalesce(land_code, '-') order by publication_id) lands from road_events where publication_id like 'r%'`,
    );
    expect(road).toEqual([{ n: String(GEOMS.length), differ: "0", lands: ["08", "09", "08", "05", "08", "-", "05", "-"] }]);
    const ab = await q<{ n: string; differ: string; filled: string }>(
      `select count(*)::text n, count(*) filter (where land_code is distinct from ${WANT_AUTOBAHN})::text differ,
              count(land_code)::text filled from autobahn_events where ext_id like 'a%'`,
    );
    expect(ab).toEqual([{ n: "5", differ: "0", filled: "3" }]);
  });

  it("follows an update of geom and leaves a write of another column alone", async () => {
    await t.pool.query("update road_events set geom = st_setsrid(st_makepoint(6.95, 50.95), 4326) where publication_id = 'r0'");
    await t.pool.query("update autobahn_events set geom = st_setsrid(st_makepoint(6.95, 50.95), 4326)::geography where ext_id = 'a1'");
    expect(await q("select land_code from road_events where publication_id = 'r0'")).toEqual([{ land_code: "05" }]);
    expect(await q("select land_code from autobahn_events where ext_id = 'a1'")).toEqual([{ land_code: "05" }]);
    // a stored value a write of another column must not touch
    await t.pool.query("alter table road_events disable trigger road_events_land");
    await t.pool.query("update road_events set land_code = 'xx' where publication_id = 'r1'");
    await t.pool.query("alter table road_events enable trigger road_events_land");
    await t.pool.query("update road_events set version = 2, payload = '{\"a\": 1}'::jsonb where publication_id = 'r1'");
    expect(await q("select land_code from road_events where publication_id = 'r1'")).toEqual([{ land_code: "xx" }]);
  });

  it("refresh_event_land fills the unfilled, rewrites only the rows whose Land moved, in chunks, and refuses a batch below 1", async () => {
    await t.pool.query("alter table road_events disable trigger road_events_land");
    for (let i = 0; i < 25; i++) await plantRoad(`old${String(i).padStart(2, "0")}`, "st_setsrid(st_makepoint(10.01, 48.4), 4326)");
    await t.pool.query("alter table road_events enable trigger road_events_land");
    expect(await q("select count(*)::int n from road_events where publication_id like 'old%' and land_code is null")).toEqual([{ n: 25 }]);
    const xmin = async (): Promise<Record<string, string>> =>
      Object.fromEntries((await q<{ p: string; x: string }>("select publication_id p, xmin::text x from road_events")).map((r) => [r.p, r.x]));
    const before = await xmin();
    await t.pool.query("call public.refresh_event_land(4)");
    const after = await xmin();
    const differ = await q<{ n: string }>(`select count(*)::text n from road_events where land_code is distinct from ${WANT_ROAD}`);
    expect(differ).toEqual([{ n: "0" }]);
    const written = Object.keys(after).filter((p) => after[p] !== before[p]).sort();
    expect(written).toEqual([...Array.from({ length: 25 }, (_, i) => `old${String(i).padStart(2, "0")}`), "r1"].sort());
    // the gazetteer moves: U becomes another Land; only its rows are written
    await t.pool.query("update gazetteer_places set admin_code = '07000001' where external_id = 'g2'");
    const before2 = await xmin();
    await t.pool.query("call public.refresh_event_land()");
    const after2 = await xmin();
    expect(Object.keys(after2).filter((p) => after2[p] !== before2[p]).sort()).toEqual(
      [...Array.from({ length: 25 }, (_, i) => `old${String(i).padStart(2, "0")}`), "r1"].sort(),
    );
    expect(await q("select distinct land_code from road_events where publication_id like 'old%'")).toEqual([{ land_code: "07" }]);
    await t.pool.query("update gazetteer_places set admin_code = '09775139' where external_id = 'g2'");
    await t.pool.query("call public.refresh_event_land()");
    for (const bad of ["0", "-1", "null"]) await expect(t.pool.query(`call public.refresh_event_land(${bad})`)).rejects.toThrow(/p_batch must be at least 1/);
  });

  it("holds road_events_open_land VALID and answers one Land's open events through it, custom and generic plan", async () => {
    expect(await q("select pg_get_indexdef(indexrelid) def, indisvalid valid from pg_index where indexrelid = 'public.road_events_open_land'::regclass")).toEqual([{ def: DEF, valid: true }]);
    const c = await t.pool.connect();
    try {
      await c.query("begin");
      await c.query("alter table road_events disable trigger road_events_land");
      await c.query(`insert into road_events (feed_key, source_id, publication_id, version, payload, land_code, closed_at)
        select 'f', 's', 'bulk' || g, 1, '{}'::jsonb, lpad((g % 16 + 1)::text, 2, '0'), case when g % 4 = 0 then now() end from generate_series(1, 20000) g`);
      await c.query("analyze road_events");
      await c.query("prepare t_land(text) as select e.id from road_events e where e.land_code = (select $1::text) and e.closed_at is null and e.deleted_at is null");
      for (const mode of ["force_custom_plan", "force_generic_plan"]) {
        await c.query(`set local plan_cache_mode = ${mode}`);
        const plan = (await c.query<{ "QUERY PLAN": string }>("explain (costs off) execute t_land('08')")).rows.map((x) => x["QUERY PLAN"]).join("\n");
        expect(plan, mode).toMatch(/Index (Only )?Scan using road_events_open_land on road_events e|Bitmap Index Scan on road_events_open_land/);
      }
    } finally {
      await c.query("rollback");
      c.release();
    }
  }, 120_000);

  it("holds charging_points_contract_count VALID and the energy summary counts the points through it index only, custom and generic plan", async () => {
    expect(await q("select pg_get_indexdef(indexrelid) def, indisvalid valid from pg_index where indexrelid = 'public.charging_points_contract_count'::regclass")).toEqual([{ def: CHARGING_DEF, valid: true }]);
    await t.pool.query(`insert into charging_sites (source_feed, site_id, geom)
      select 'f' || (g % 3), 's' || g, st_setsrid(st_makepoint(9 + (g % 100) / 100.0, 49), 4326)::geography from generate_series(1, 30000) g`);
    await t.pool.query(`insert into charging_points (source_feed, point_key, evse_id, site_id, geom)
      select 'f' || (g / 3 % 3), 'p' || g, case when g % 5 > 0 then 'e' || g end, 's' || (g / 3), st_setsrid(st_makepoint(9, 49), 4326)::geography from generate_series(3, 90000) g`);
    // vacuum cannot run in a transaction: the rows go at the end of the test
    await t.pool.query("vacuum analyze charging_points");
    await t.pool.query("vacuum analyze charging_sites");
    const c = await t.pool.connect();
    try {
      await c.query(`prepare t_energy(text[]) as ${ENERGY}`);
      for (const mode of ["force_custom_plan", "force_generic_plan"]) {
        await c.query(`set plan_cache_mode = ${mode}`);
        const plan = (await c.query<{ "QUERY PLAN": string }>("explain (analyze, costs off, timing off, summary off) execute t_energy('{f0,f1,f2}')")).rows.map((x) => x["QUERY PLAN"]).join("\n");
        expect(plan, mode).toMatch(/Index Only Scan using charging_points_contract_count on charging_points p[^\n]*\n(\s*(Index Cond|Filter):[^\n]*\n)*\s*Heap Fetches: 0\n/);
        expect(plan, mode).not.toMatch(/Seq Scan on charging_points/);
      }
      expect((await c.query("execute t_energy('{f0,f1,f2}')")).rows.length).toBe(3);
    } finally {
      await c.query("reset plan_cache_mode");
      await c.query("deallocate all");
      c.release();
    }
    await t.pool.query("delete from charging_points");
    await t.pool.query("delete from charging_sites");
  }, 120_000);

  it("road_events_live and road_events_current end with land_code, with their grants and rows", async () => {
    const cols = async (rel: string): Promise<string[]> =>
      (await q<{ a: string }>("select attname a from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum", [rel])).map((r) => r.a);
    const base = await cols("public.road_events");
    expect(await cols("public.road_events_live")).toEqual(base);
    expect(await cols("public.road_events_current")).toEqual(base);
    expect(base.slice(-2)).toEqual(["entry_static", "land_code"]);
    expect(await q(`select has_table_privilege('viafrei_digest', 'public.road_events_live', 'select') d, has_table_privilege('viafrei_mcp', 'public.road_events_live', 'select') m`)).toEqual([{ d: true, m: true }]);
    expect(await q("select land_code from road_events_live where publication_id = 'r3'")).toEqual([{ land_code: "05" }]);
  });

  it("run again keeps everything, outside a transaction; an INVALID index of its name is built again", async () => {
    const oid = async (): Promise<number> => (await q<{ o: number }>("select 'public.road_events_open_land'::regclass::oid o"))[0]!.o;
    const first = await oid();
    await reapply(t, service(), FILE);
    expect(await oid()).toBe(first);
    expect(await q("select indisvalid v from pg_index where indexrelid = 'public.charging_points_contract_count'::regclass")).toEqual([{ v: true }]);
    await t.pool.query("drop index public.road_events_open_land");
    await t.pool.query("insert into road_events (feed_key, source_id, publication_id, version, payload) values ('f', 's', 'dup1', 1, '{}'), ('f', 's', 'dup2', 1, '{}')");
    await expect(t.pool.query("create unique index concurrently road_events_open_land on public.road_events (land_code) where closed_at is null and deleted_at is null")).rejects.toThrow();
    expect((await t.pool.query("select 1 from pg_index where indexrelid = 'public.road_events_open_land'::regclass and not indisvalid")).rowCount).toBe(1);
    await reapply(t, service(), FILE);
    expect(await q("select pg_get_indexdef(indexrelid) def, indisvalid valid from pg_index where indexrelid = 'public.road_events_open_land'::regclass")).toEqual([{ def: DEF, valid: true }]);
  });
});
