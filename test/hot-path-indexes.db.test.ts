/**
 * 0317's two indexes for the digest's hottest reads: each present, valid and
 * of the definition production was given by hand first; each read planned
 * through its index on a seeded table; and the file a no-op on a database that
 * already holds them (production's case), while an INVALID leftover is rebuilt.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { DatabaseService } from "../src/service.js";
import { DomainDb, endPool } from "./domain-db.js";

const url = process.env["TEST_DATABASE_URL"];
const required = process.env["VF_REQUIRE_DB"] === "1";

if (url === undefined && required) {
  describe("0317 hot path indexes", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the hot path index test did not run");
    });
  });
}

const DEFS = {
  road_events_open_feed: "CREATE INDEX road_events_open_feed ON public.road_events USING btree (feed_key) WHERE ((closed_at IS NULL) AND (deleted_at IS NULL))",
  db_facilities_point_geog:
    "CREATE INDEX db_facilities_point_geog ON public.db_facilities USING gist (((st_point(lon, lat))::geography)) WHERE ((lon IS NOT NULL) AND (lat IS NOT NULL))",
};
const NAMES = Object.keys(DEFS);

describe.skipIf(url === undefined)("0317 hot path indexes", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "hot");
  let svc: DatabaseService | undefined;

  beforeAll(async () => {
    await t.make([]);
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
    svc = new DatabaseService({ config: loadConfig({ DATABASE_URL: t.url, DB_MIGRATE_LOCK_PAUSE_S: "1" }, "serve"), log });
  }, 900_000);

  afterAll(async () => {
    const s = svc;
    if (s !== undefined) await endPool(s.pool, () => s.close());
    await t.drop();
  });

  type Ix = { name: string; def: string; valid: boolean; ready: boolean; oid: number };
  const indexes = async (): Promise<Ix[]> =>
    (
      await t.pool.query<Ix>(
        `select c.relname as name, pg_get_indexdef(i.indexrelid) as def, i.indisvalid as valid, i.indisready as ready, i.indexrelid::int as oid
           from pg_index i join pg_class c on c.oid = i.indexrelid
          where c.relnamespace = 'public'::regnamespace and c.relname = any($1) order by c.relname`,
        [NAMES],
      )
    ).rows;

  it("has both indexes, valid, with the definitions production was given", async () => {
    expect((await indexes()).map(({ name, def, valid, ready }) => ({ name, def, valid, ready }))).toEqual(
      Object.entries(DEFS)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, def]) => ({ name, def, valid: true, ready: true })),
    );
  });

  const plan = async (c: pg.PoolClient, sql: string): Promise<string> =>
    (await c.query<{ "QUERY PLAN": string }>(`explain ${sql}`)).rows.map((x) => x["QUERY PLAN"]).join("\n");

  it("plans the open events of a few feeds through road_events_open_feed, not the location index", async () => {
    await t.planted(async (c) => {
      // 40 feeds, most events closed or deleted: the open ones of two feeds are a few rows of thousands.
      await c.query(
        `insert into public.road_events (feed_key, source_id, publication_id, version, payload, geom, closed_at, deleted_at)
         select 'feed_' || (g % 40), 'S', g::text, 1, '{}', st_setsrid(st_makepoint(9 + (g % 100) * 0.01, 48 + (g % 70) * 0.01), 4326),
                case when g % 4 <> 0 then now() end, case when g % 7 = 0 then now() end
           from generate_series(1, 12000) g`,
      );
      await c.query("analyze public.road_events");
      const p = await plan(c, "select id, publication_id from public.road_events_live where closed_at is null and feed_key = any(array['feed_3', 'feed_17'])");
      expect(p).toMatch(/Index Scan using road_events_open_feed|Bitmap Index Scan on road_events_open_feed/);
      expect(p).not.toMatch(/road_events_contract_location|Seq Scan/);
    });
  });

  it("plans a station's facilities within a distance through db_facilities_point_geog, not a scan of the table", async () => {
    await t.planted(async (c) => {
      await c.query(
        `insert into public.db_facilities (equipment_no, station_no, kind, state, lon, lat, state_since, first_seen_at, last_seen_at, source_feed, source_publisher)
         select g::text, (g % 900)::text, 'elevator', 'active',
                case when g % 50 <> 0 then 6 + (g % 97) * 0.08 end, case when g % 50 <> 0 then 47.5 + (g % 89) * 0.06 end,
                now(), now(), now(), 'db_fasta', 'DB InfraGO'
           from generate_series(1, 6000) g`,
      );
      await c.query("analyze public.db_facilities");
      const p = await plan(
        c,
        "select f.equipment_no, f.kind, f.state from public.db_facilities_live f where st_dwithin(st_point(f.lon, f.lat)::geography, st_point(9.18, 48.78)::geography, 300)",
      );
      expect(p).toMatch(/Index Scan using db_facilities_point_geog|Bitmap Index Scan on db_facilities_point_geog/);
      expect(p).not.toMatch(/Seq Scan/);
    });
  });

  it("is a no-op over the indexes production already holds, and rebuilds an INVALID leftover", async () => {
    const s = svc;
    if (s === undefined) throw new Error("no service");
    const before = await indexes();
    // Production's case: the indexes made by hand, the ledger without 317.
    await t.pool.query("delete from schema_migrations where version = 317");
    const again = await s.migrate("cli");
    expect(again.ok, again.lines.join("\n")).toBe(true);
    expect(again.lines.filter((l) => l.startsWith("applying")).map((l) => l.split(" ")[1])).toEqual(["0317_hot_path_indexes.sql"]);
    expect(again.lines.find((l) => l.startsWith("applying 0317_"))).toMatch(/\(no transaction — see the file's -- no-transaction: note\)$/);
    expect(await indexes()).toEqual(before);
    // A failed concurrent build leaves an INVALID index: the file drops it and builds it again.
    await t.pool.query("update pg_index set indisvalid = false where indexrelid = 'public.db_facilities_point_geog'::regclass");
    await t.pool.query("delete from schema_migrations where version = 317");
    const redo = await s.migrate("cli");
    expect(redo.ok, redo.lines.join("\n")).toBe(true);
    const after = await indexes();
    expect(after.map(({ name, def, valid }) => ({ name, def, valid }))).toEqual(before.map(({ name, def, valid }) => ({ name, def, valid })));
    expect(after.find((x) => x.name === "db_facilities_point_geog")?.oid).not.toBe(before.find((x) => x.name === "db_facilities_point_geog")?.oid);
    expect(after.find((x) => x.name === "road_events_open_feed")?.oid).toBe(before.find((x) => x.name === "road_events_open_feed")?.oid);
  });
});
