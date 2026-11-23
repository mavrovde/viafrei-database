/**
 * domains.road_events against a real catalogue: the domain shape compared with
 * domains.speed_cameras, the key that carries the publication creator, the
 * suspended flag the database derives from the payload, the writes the ingestor
 * role makes, the open-by-road index, the merge, and the old tables left as the
 * baseline made them.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { DomainDb, MERGE_COLUMNS, refusal, SYSTEM, upsertSql, WRITER_TYPES } from "./domain-db.js";

const url = process.env["TEST_DATABASE_URL"];
const required = process.env["VF_REQUIRE_DB"] === "1";

if (url === undefined && required) {
  describe("domains.road_events", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the road events test did not run");
    });
  });
}

const E = "domains.road_events";
const ROAD: Readonly<Record<string, string>> = {
  publication_creator: "text",
  publication_id: "text",
  version: "integer",
  publisher: "text",
  event_type: "text",
  road_number: "text",
  referent_from: "text",
  referent_to: "text",
  distance_from_m: "integer",
  distance_to_m: "integer",
  feed_ts: "timestamp with time zone",
  overall_start: "timestamp with time zone",
  overall_end: "timestamp with time zone",
  closure_starts_at: "timestamp with time zone",
  closure_ends_at: "timestamp with time zone",
  valid_windows: "jsonb",
  suspended: "boolean",
  confidentiality: "text",
  payload: "jsonb",
  locations: "jsonb",
  record_types: "jsonb",
  source_publisher: "text",
  provider_updated_at: "timestamp with time zone",
};
const REQUIRED = new Set(["publication_creator", "publication_id", "version", "payload", "locations", "record_types"]);
const DEFAULTED: Readonly<Record<string, string>> = { locations: "'[]'::jsonb", record_types: "'[]'::jsonb" };

type Row = { external_id: string; match_key?: string | null; observed_at?: string | null; geom_wkt?: string | null; extras?: unknown } & Record<string, unknown>;

const validity = (status: string): unknown => ({ situationRecord: [{ validity: [{ validityStatus: [{ "#text": status }] }] }] });

describe.skipIf(url === undefined)("domains.road_events", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "road_ev");

  beforeAll(async () => {
    await t.make([
      ["roads-high", "road_events", 80],
      ["roads-low", "road_events", 20],
      ["cameras-only", "speed_cameras", 50],
    ]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  const upsert = (c: pg.PoolClient, source: string, rows: Row[]): Promise<pg.QueryResult<{ inserted: boolean }>> => c.query<{ inserted: boolean }>(upsertSql(E, ROAD), [JSON.stringify(rows), source, "default"]);

  const EVENT: Row = {
    external_id: "DE-MDM-AUTOBAHN:RW-1",
    geom_wkt: "LINESTRING(9.9 53.5, 10.0 53.6)",
    publication_creator: "DE-MDM-AUTOBAHN",
    publication_id: "RW-1",
    version: 3,
    publisher: "Eine Autobahngesellschaft",
    event_type: "roadworks",
    road_number: "A7",
    referent_from: "AS Nord",
    referent_to: "AS Süd",
    distance_from_m: 120,
    distance_to_m: 4300,
    feed_ts: "2026-11-14T08:00:00Z",
    overall_start: "2026-11-10T00:00:00Z",
    overall_end: "2026-12-01T00:00:00Z",
    closure_starts_at: "2026-11-15T20:00:00Z",
    closure_ends_at: "2026-11-16T05:00:00Z",
    valid_windows: [{ start: "2026-11-15T20:00:00Z", end: "2026-11-16T05:00:00Z" }],
    suspended: null,
    confidentiality: "noRestriction",
    payload: validity("active"),
    locations: [{ seq: 0, road_number: "A7", referent_from: "AS Nord", referent_to: "AS Süd", distance_from_m: 120, distance_to_m: 4300, lon: 9.9, lat: 53.5 }],
    record_types: ["MaintenanceWorks"],
    source_publisher: "Ein Verbund",
    provider_updated_at: "2026-11-14T07:59:00Z",
  };

  it("is at head with the migration applied", async () => {
    expect((await t.pool.query("select 1 from schema_migrations where version = 297 and name = '0297_domain_road_events.sql'")).rowCount).toBe(1);
  });

  it("has the system columns of speed_cameras, then the domain columns, each in a type a writer declares", async () => {
    const cameras = (await t.columnsOf("speed_cameras")).slice(0, SYSTEM.length);
    const mine = await t.columnsOf("road_events");
    expect(mine.map((x) => x.column_name)).toEqual([...SYSTEM, ...Object.keys(ROAD)]);
    expect(mine.slice(0, SYSTEM.length)).toEqual(cameras);
    for (const x of mine.slice(SYSTEM.length)) {
      expect(x.data_type, x.column_name).toBe(ROAD[x.column_name]);
      expect(WRITER_TYPES.has(x.data_type), x.column_name).toBe(true);
      expect(x.is_nullable, x.column_name).toBe(REQUIRED.has(x.column_name) ? "NO" : "YES");
      expect(x.column_default, x.column_name).toBe(DEFAULTED[x.column_name] ?? null);
    }
  });

  it("has the constraints and indexes of the convention, and its own", async () => {
    const own = /T_(external_id_shape|publication_creator|publication_creator_no_colon|publication_id|payload_object|valid_windows_array|locations_array|record_types_array|open|ref_key) /;
    const shape = await t.shape("road_events");
    expect(shape.filter((d) => own.test(d))).toEqual([
      "CREATE INDEX T_open ON domains.T USING btree (road_number, overall_start DESC) WHERE (closed_at IS NULL)",
      "CREATE INDEX T_ref_key ON domains.T USING btree (road_ref_key(road_number)) WHERE ((road_number IS NOT NULL) AND (closed_at IS NULL))",
      "c T_external_id_shape CHECK ((external_id = ((publication_creator || ':'::text) || publication_id)))",
      "c T_locations_array CHECK ((jsonb_typeof(locations) = 'array'::text))",
      "c T_payload_object CHECK ((jsonb_typeof(payload) = 'object'::text))",
      "c T_publication_creator CHECK ((publication_creator <> ''::text))",
      "c T_publication_creator_no_colon CHECK ((POSITION((':'::text) IN (publication_creator)) = 0))",
      "c T_publication_id CHECK ((publication_id <> ''::text))",
      "c T_record_types_array CHECK ((jsonb_typeof(record_types) = 'array'::text))",
      "c T_valid_windows_array CHECK (((valid_windows IS NULL) OR (jsonb_typeof(valid_windows) = 'array'::text)))",
    ]);
    expect(shape.filter((d) => !own.test(d))).toEqual(await t.convention());
  });

  it("enables and forces row-level security with the policies of speed_cameras, and the merged view", async () => {
    expect(await t.rls("road_events")).toEqual({ e: true, f: true });
    expect(await t.policies("road_events")).toEqual(await t.policies("speed_cameras"));
    expect((await t.columnsOf("road_events_merged")).map((x) => x.column_name)).toEqual([...SYSTEM, ...Object.keys(ROAD), ...MERGE_COLUMNS]);
  });

  it("grants what speed_cameras grants, and no reader anything", async () => {
    const g = await t.grants(["road_events", "road_events_merged", "speed_cameras", "speed_cameras_merged"]);
    expect(g.get("road_events")).toEqual(g.get("speed_cameras"));
    expect(g.get("road_events_merged")).toEqual(g.get("speed_cameras_merged"));
    expect(g.get("road_events")).toEqual(["viafrei_ingestor:INSERT,SELECT,UPDATE"]);
    const r = await t.readable([E, `${E}_merged`]);
    expect(r.checked).toBe(10);
    expect(r.open).toEqual([]);
  });

  it("takes an event through the ingestor's upsert, and an unchanged one moves no row", async () => {
    await t.asSource("roads-high", async (c) => {
      expect((await upsert(c, "roads-high", [EVENT])).rows).toEqual([{ inserted: true }]);
      expect((await upsert(c, "roads-high", [EVENT])).rows).toEqual([]);
      expect((await upsert(c, "roads-high", [{ ...EVENT, version: 4 }])).rows).toEqual([{ inserted: false }]);
      const r = await c.query<Record<string, unknown>>(
        `select external_id, publication_creator, publication_id, version, road_number, suspended, valid_windows, locations, record_types,
                ST_GeometryType(geom) as g, overall_start = '2026-11-10T00:00:00Z' as starts
           from ${E}`,
      );
      expect(r.rows).toEqual([
        {
          external_id: "DE-MDM-AUTOBAHN:RW-1",
          publication_creator: "DE-MDM-AUTOBAHN",
          publication_id: "RW-1",
          version: 4,
          road_number: "A7",
          suspended: false,
          valid_windows: EVENT["valid_windows"],
          locations: EVENT["locations"],
          record_types: ["MaintenanceWorks"],
          g: "ST_LineString",
          starts: true,
        },
      ]);
    });
  });

  it("derives suspended from the payload: a writer's own value is overwritten, on insert and on any update", async () => {
    await t.asSource("roads-high", async (c) => {
      const S: Row = { ...EVENT, external_id: "DE-MDM-AUTOBAHN:RW-2", publication_id: "RW-2", payload: validity("suspended"), suspended: false };
      await upsert(c, "roads-high", [S]);
      const flag = async (): Promise<unknown> => (await c.query<{ s: boolean }>(`select suspended as s from ${E} where publication_id = 'RW-2'`)).rows[0]?.s;
      expect(await flag()).toBe(true);
      await c.query(`update ${E} set suspended = false where publication_id = 'RW-2'`);
      expect(await flag()).toBe(true);
      await upsert(c, "roads-high", [{ ...S, payload: validity("active"), suspended: true }]);
      expect(await flag()).toBe(false);
    });
  });

  it("keeps the same publication id of two creators in one feed apart, and refuses a key that disagrees with them", async () => {
    await t.asSource("roads-high", async (c) => {
      const other: Row = { ...EVENT, external_id: "DE-OTHER:RW-1", publication_creator: "DE-OTHER" };
      expect((await upsert(c, "roads-high", [EVENT, other])).rows).toEqual([{ inserted: true }, { inserted: true }]);
      const n = await c.query<{ n: number }>(`select count(*)::int as n from ${E} where publication_id = 'RW-1'`);
      expect(n.rows[0]?.n).toBe(2);
      // a publication id may hold a ':' — the creator cannot, so the first ':' of the key is the split
      expect((await upsert(c, "roads-high", [{ ...EVENT, external_id: "DE-OTHER:RW:1", publication_creator: "DE-OTHER", publication_id: "RW:1" }])).rows).toEqual([{ inserted: true }]);
      for (const [row, code, word] of [
        [{ ...EVENT, external_id: "RW-1" }, "23514", "road_events_external_id_shape"],
        [{ ...EVENT, external_id: "", publication_creator: "", publication_id: "" }, "23514", "road_events_external_id_check"],
        [{ ...EVENT, external_id: ":RW-1", publication_creator: "" }, "23514", "road_events_publication_creator"],
        [{ ...EVENT, external_id: "DE-MDM-AUTOBAHN:", publication_id: "" }, "23514", "road_events_publication_id"],
        // creator "DE-OTHER:RW" with id "1" would be the key of creator "DE-OTHER" with id "RW:1"
        [{ ...EVENT, external_id: "DE-OTHER:RW:1", publication_creator: "DE-OTHER:RW", publication_id: "1" }, "23514", "road_events_publication_creator_no_colon"],
        [{ ...EVENT, payload: null }, "23502", "payload"],
        [{ ...EVENT, payload: [] }, "23514", "road_events_payload_object"],
        [{ ...EVENT, version: null }, "23502", "version"],
        [{ ...EVENT, valid_windows: { start: "x" } }, "23514", "road_events_valid_windows_array"],
        [{ ...EVENT, locations: null }, "23502", "locations"],
        [{ ...EVENT, locations: { seq: 0 } }, "23514", "road_events_locations_array"],
        [{ ...EVENT, record_types: "MaintenanceWorks" }, "23514", "road_events_record_types_array"],
      ] as const) {
        await c.query("savepoint s");
        const e = await refusal(upsert(c, "roads-high", [row]));
        await c.query("rollback to savepoint s");
        expect(e?.code, word).toBe(code);
        expect(e?.message, word).toContain(word);
      }
    });
  });

  it("refuses a write for another source, a source of another domain, and without a source", async () => {
    await t.asSource("roads-high", async (c) => {
      expect((await refusal(upsert(c, "roads-low", [EVENT])))?.code).toBe("42501");
    });
    await t.asSource("cameras-only", async (c) => {
      expect((await refusal(upsert(c, "cameras-only", [EVENT])))?.code).toBe("42501");
    });
    await t.asSource(null, async (c) => {
      expect((await refusal(upsert(c, "roads-high", [EVENT])))?.code).toBe("42501");
    });
  });

  it("finds the open events of a road through its indexes", async () => {
    await t.planted(async (c) => {
      await c.query(
        `insert into ${E} (source_id, external_id, publication_creator, publication_id, version, road_number, overall_start, payload, closed_at)
         select 'roads-high', 'C:' || g, 'C', g::text, 1, 'A' || (g % 300), now() - g * interval '1 minute', '{}',
                case when g % 3 = 0 then now() end
           from generate_series(1, 6000) g`,
      );
      await c.query(`analyze ${E}`);
      await c.query("set local enable_seqscan = off");
      const plan = async (sql: string): Promise<string> => (await c.query<{ "QUERY PLAN": string }>(`explain ${sql}`)).rows.map((x) => x["QUERY PLAN"]).join("\n");
      expect(await plan(`select publication_id from ${E} where road_number = 'A7' and closed_at is null order by overall_start desc limit 20`)).toMatch(/road_events_open/);
      expect(await plan(`select publication_id from ${E} where road_ref_key(road_number) = 'A7' and road_number is not null and closed_at is null`)).toMatch(/road_events_ref_key/);
    });
  });

  it("merges open events by trust, then freshness", async () => {
    await t.planted(async (c) => {
      const plant = (source: string, id: string, observed: string): Promise<unknown> =>
        c.query(
          `insert into ${E} (source_id, external_id, match_key, observed_at, publication_creator, publication_id, version, payload)
           values ($1, 'C:' || $2, 'K1', $3::timestamptz, 'C', $2, 1, '{}')`,
          [source, id, observed],
        );
      await plant("roads-high", "A", "2026-11-01T00:00:00Z");
      await plant("roads-low", "B", "2026-11-05T00:00:00Z");
      const r = await c.query<{ source_id: string; source_count: number }>(`select source_id, source_count from ${E}_merged where entity_key = 'K1'`);
      expect(r.rows).toEqual([{ source_id: "roads-high", source_count: 2 }]);
    });
  });

  it("leaves the old tables as the baseline made them: the same columns and constraints, plus what a later migration names", async () => {
    // 0330 appends road_events.entry_static (the clock-free entry facts, filled at write time) and 0338
    // road_events.land_code (the event's Land, filled at write time); nothing else changes.
    const added: Readonly<Record<string, readonly string[]>> = { road_events: ["entry_static", "land_code"] };
    for (const table of ["road_events", "road_event_locations", "road_event_ticks", "road_event_record_types", "road_event_twins"]) {
      const a = await t.baselineAgreement(table);
      expect(a.baseline.columns.length, table).toBeGreaterThan(4);
      expect(a.catalogue, table).toEqual({ ...a.baseline, columns: [...a.baseline.columns, ...(added[table] ?? [])] });
    }
  });
});
