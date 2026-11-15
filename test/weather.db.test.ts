/**
 * The weather domains against a real catalogue: the warnings and their English
 * text as two domains, the road-weather stations and the forecast series, each
 * compared with domains.speed_cameras; the keys held equal to their parts; the
 * content join the old function makes, made over the new tables; the forecast's
 * day partitions and retention row; and the old tables and their readers left as
 * the baseline made them.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { appendSql, DomainDb, MERGE_COLUMNS, refusal, SYSTEM, upsertSql, WRITER_TYPES } from "./domain-db.js";

const url = process.env["TEST_DATABASE_URL"];
const required = process.env["VF_REQUIRE_DB"] === "1";

if (url === undefined && required) {
  describe("the weather domains", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the weather test did not run");
    });
  });
}

type Cols = Readonly<Record<string, string>>;
const TZ = "timestamp with time zone";
const DP = "double precision";
const WARN: Cols = {
  identifier: "text",
  warncell_id: "text",
  version: "integer",
  area_desc: "text",
  event: "text",
  event_code_ii: "text",
  level: "integer",
  level_source: "text",
  severity: "text",
  urgency: "text",
  certainty: "text",
  headline: "text",
  description: "text",
  instruction: "text",
  official_sha256: "text",
  valid_from: TZ,
  valid_to: TZ,
  published_at: TZ,
  area_sha256: "text",
  closed_reason: "text",
  source_publisher: "text",
  provider_updated_at: TZ,
  last_seen_at: TZ,
};
const EN: Cols = {
  identifier: "text",
  base_identifier: "text",
  msg_type: "text",
  language: "text",
  event: "text",
  event_code: "integer",
  event_ii: "text",
  headline: "text",
  description: "text",
  instruction: "text",
  content_sha256: "text",
  sent_at: TZ,
  valid_from: TZ,
  valid_to: TZ,
  warncell_ids: "jsonb",
  closed_reason: "text",
  source_publisher: "text",
  provider_updated_at: TZ,
};
const STATIONS: Cols = {
  name: "text",
  segment_type: "integer",
  surface: "integer",
  position_source: "text",
  height_m: "integer",
  flag_raw: "text",
  inactive: "boolean",
  inactive_raw: "text",
  source_publisher: "text",
  provider_updated_at: TZ,
  last_seen_at: TZ,
};
const FORECAST: Cols = {
  station_id: "text",
  valid_at: TZ,
  run_at: TZ,
  tl: DP,
  tlsta: DP,
  rrl1c: DP,
  rrs1c: DP,
  rr6: DP,
  wwl6: DP,
  wws3: DP,
  rrs3c: DP,
  r650: DP,
  rc: "integer",
  ts: DP,
  td: DP,
  source_run_id: "bigint",
};

type Table = { name: string; cols: Cols; kind: "state" | "tick"; required: readonly string[]; defaults?: Readonly<Record<string, string>>; own: readonly string[] };
const HASH = (t: string, c: string, n: string): string => `c ${t}_${n} CHECK ((${c} ~ '^[0-9a-f]{64}$'::text))`;
const CLOSED = (t: string): string =>
  `c ${t}_closed_reason CHECK (((closed_reason IS NULL) OR ((closed_at IS NOT NULL) AND (closed_reason = ANY (ARRAY['withdrawn'::text, 'superseded'::text])))))`;
const TABLES: readonly Table[] = [
  {
    name: "weather_warnings",
    cols: WARN,
    kind: "state",
    required: ["identifier", "warncell_id", "version", "level", "official_sha256", "valid_from", "area_sha256"],
    own: [
      "CREATE INDEX T_live_cell ON domains.T USING btree (warncell_id, level DESC, valid_to) WHERE (closed_at IS NULL)",
      HASH("T", "area_sha256", "area_hash"),
      CLOSED("T"),
      "c T_external_id_shape CHECK ((external_id = ((((identifier || ':'::text) || warncell_id) || ':'::text) || version)))",
      "c T_geom_area CHECK (((geom IS NULL) OR (geometrytype(geom) = 'MULTIPOLYGON'::text)))",
      HASH("T", "official_sha256", "hash"),
      "c T_level CHECK (((level >= 0) AND (level <= 4)))",
      "c T_level_source CHECK (((level_source IS NULL) OR (level_source = ANY (ARRAY['published'::text, 'derived_from_severity'::text]))))",
      "c T_window CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))",
    ],
  },
  {
    name: "weather_warnings_en",
    cols: EN,
    kind: "state",
    required: ["identifier", "base_identifier", "language", "content_sha256", "warncell_ids"],
    defaults: { warncell_ids: "'[]'::jsonb" },
    own: [
      "CREATE INDEX T_live_sent ON domains.T USING btree (sent_at, valid_from) WHERE (closed_at IS NULL)",
      CLOSED("T"),
      "c T_external_id_shape CHECK ((external_id = ((identifier || ':'::text) || content_sha256)))",
      "c T_geom_none CHECK ((geom IS NULL))",
      HASH("T", "content_sha256", "hash"),
      "c T_language CHECK ((language <> ''::text))",
      "c T_warncell_ids_array CHECK ((jsonb_typeof(warncell_ids) = 'array'::text))",
      "c T_window CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_to >= valid_from)))",
    ],
  },
  {
    name: "road_weather_stations",
    cols: STATIONS,
    kind: "state",
    required: ["name"],
    own: [
      "c T_geom_point CHECK (((geom IS NULL) OR (geometrytype(geom) = 'POINT'::text)))",
      "c T_segment CHECK (((segment_type IS NULL) OR (segment_type = ANY (ARRAY[1, 2]))))",
      "c T_surface CHECK (((surface IS NULL) OR (surface = ANY (ARRAY[1, 2]))))",
    ],
  },
  {
    name: "road_weather_forecast",
    cols: FORECAST,
    kind: "tick",
    required: ["station_id", "valid_at", "run_at"],
    own: [
      "CREATE INDEX T_brin ON ONLY domains.T USING brin (observed_at)",
      "CREATE INDEX T_station ON ONLY domains.T USING btree (station_id, observed_at DESC, valid_at)",
      "c T_geom_none CHECK ((geom IS NULL))",
      "c T_rc CHECK (((rc IS NULL) OR ((rc >= 1) AND (rc <= 6))))",
    ],
  },
];
const STATES = TABLES.filter((x) => x.kind === "state");
const byName = (n: string): Table => {
  const x = TABLES.find((y) => y.name === n);
  if (x === undefined) throw new Error(n);
  return x;
};

type Row = { external_id: string; match_key?: string | null; observed_at?: string | null; geom_wkt?: string | null } & Record<string, unknown>;
const SHA = (c: string): string => c.repeat(64);

describe.skipIf(url === undefined)("the weather domains", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "weather");
  const src = (table: string): string => `${table.replaceAll("_", "-")}-a`;

  beforeAll(async () => {
    await t.make([...TABLES.map((x) => [src(x.name), x.name, 60] as const), ["cameras-only", "speed_cameras", 50]]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  const upsert = (c: pg.PoolClient, table: Table, rows: Row[]): Promise<pg.QueryResult<{ inserted: boolean }>> =>
    c.query<{ inserted: boolean }>(upsertSql(`domains.${table.name}`, table.cols), [JSON.stringify(rows), src(table.name), "default"]);
  const append = (c: pg.PoolClient, rows: Row[]): Promise<pg.QueryResult<{ inserted: boolean }>> =>
    c.query<{ inserted: boolean }>(appendSql("domains.road_weather_forecast", FORECAST), [JSON.stringify(rows), src("road_weather_forecast"), "default"]);

  const now = new Date();
  const at = (minutes: number): string => new Date(now.getTime() + minutes * 60_000).toISOString();
  const WARNING: Row = {
    external_id: "2.49.0.0.276.0.DWD.PVW.1:808111000:2",
    geom_wkt: "MULTIPOLYGON(((9 48, 9.1 48, 9.1 48.1, 9 48.1, 9 48)))",
    identifier: "2.49.0.0.276.0.DWD.PVW.1",
    warncell_id: "808111000",
    version: 2,
    area_desc: "Stadt Musterstadt",
    event: "GLÄTTE",
    event_code_ii: "84",
    level: 2,
    level_source: "published",
    severity: "Moderate",
    urgency: "Immediate",
    certainty: "Likely",
    headline: "Amtliche WARNUNG vor GLÄTTE",
    description: "Es tritt leichter Frost auf.",
    instruction: null,
    official_sha256: SHA("a"),
    valid_from: "2026-11-15T18:00:00Z",
    valid_to: "2026-11-16T08:00:00Z",
    published_at: "2026-11-15T16:00:00Z",
    area_sha256: SHA("b"),
    closed_reason: null,
    source_publisher: "Ein Wetterdienst",
    provider_updated_at: "2026-11-15T16:00:00Z",
    last_seen_at: "2026-11-15T16:05:00Z",
  };
  const ENGLISH: Row = {
    external_id: `2.49.0.0.276.0.DWD.PVW.1.EN:${SHA("c")}`,
    identifier: "2.49.0.0.276.0.DWD.PVW.1.EN",
    base_identifier: "2.49.0.0.276.0.DWD.PVW.1",
    msg_type: "Update",
    language: "en-GB",
    event: "SLIPPERY ROADS",
    event_code: 84,
    event_ii: "84",
    headline: "Official WARNING of SLIPPERY ROADS",
    description: "Slight frost is expected.",
    instruction: null,
    content_sha256: SHA("c"),
    sent_at: "2026-11-15T16:00:00Z",
    valid_from: "2026-11-15T18:00:00Z",
    valid_to: "2026-11-16T08:00:00Z",
    warncell_ids: ["808111000", "808112000"],
    closed_reason: null,
    source_publisher: "Ein Wetterdienst",
    provider_updated_at: "2026-11-15T16:00:00Z",
  };
  const STATION: Row = {
    external_id: "S-1",
    geom_wkt: "POINT(9.2 48.7)",
    name: "Brücke am Musterberg",
    segment_type: 2,
    surface: 1,
    position_source: "catalogue",
    height_m: 412,
    flag_raw: "B",
    inactive: false,
    inactive_raw: null,
    source_publisher: "Ein Wetterdienst",
    provider_updated_at: "2026-11-15T00:00:00Z",
    last_seen_at: "2026-11-15T00:05:00Z",
  };
  const POINT = (valid: string, run: string, observed: string): Row => ({
    external_id: `S-1:${valid}`,
    observed_at: observed,
    station_id: "S-1",
    valid_at: valid,
    run_at: run,
    tl: -1.5,
    tlsta: -1.2,
    rrl1c: 0,
    rrs1c: 0,
    rr6: 0.2,
    wwl6: 0,
    wws3: 0,
    rrs3c: 0,
    r650: 0,
    rc: 3,
    ts: -2.25,
    td: -3,
    source_run_id: 11,
  });

  it("is applied", async () => {
    expect((await t.pool.query("select 1 from schema_migrations where version = 300 and name = '0300_domain_weather.sql'")).rowCount).toBe(1);
  });

  it("has the system columns of speed_cameras, then the domain columns, each in a type a writer declares", async () => {
    const cameras = (await t.columnsOf("speed_cameras")).slice(0, SYSTEM.length);
    for (const table of TABLES) {
      const mine = await t.columnsOf(table.name);
      expect(mine.map((x) => x.column_name), table.name).toEqual([...SYSTEM, ...Object.keys(table.cols)]);
      expect(mine.slice(0, SYSTEM.length), table.name).toEqual(cameras);
      for (const x of mine.slice(SYSTEM.length)) {
        const where = `${table.name}.${x.column_name}`;
        expect(x.data_type, where).toBe(table.cols[x.column_name]);
        expect(WRITER_TYPES.has(x.data_type), where).toBe(true);
        expect(x.is_nullable, where).toBe(table.required.includes(x.column_name) ? "NO" : "YES");
        expect(x.column_default, where).toBe(table.defaults?.[x.column_name] ?? null);
      }
    }
  });

  it("has the constraints and indexes of the convention, and each table its own", async () => {
    const model = await t.shape("speed_cameras");
    for (const table of TABLES) {
      const shape = (await t.shape(table.name)).map((d) => d.replaceAll(table.name, "T"));
      const own = shape.filter((d) => table.own.includes(d));
      expect(own.sort(), table.name).toEqual([...table.own].sort());
      const rest = shape.filter((d) => !table.own.includes(d));
      if (table.kind === "state") {
        expect(rest, table.name).toEqual(model);
      } else {
        expect(rest.filter((d) => /T_(owner_key|pkey) /.test(d)), table.name).toEqual([
          "CREATE UNIQUE INDEX T_owner_key ON ONLY domains.T USING btree (source_id, feed, external_id, observed_at)",
          "CREATE UNIQUE INDEX T_pkey ON ONLY domains.T USING btree (id, observed_at)",
          "p T_pkey PRIMARY KEY (id, observed_at)",
          "u T_owner_key UNIQUE (source_id, feed, external_id, observed_at)",
        ]);
        expect(rest.filter((d) => !/T_(owner_key|pkey) /.test(d)).map((d) => d.replace(" ON ONLY ", " ON ")), table.name).toEqual(model.filter((d) => !/T_(owner_key|pkey) /.test(d)));
      }
    }
  });

  it("has the policies, merged views and grants of the convention, and no reader anything", async () => {
    const cameras = await t.policies("speed_cameras");
    for (const table of TABLES) {
      expect(await t.rls(table.name), table.name).toEqual({ e: true, f: true });
      expect(await t.policies(table.name), table.name).toEqual(table.kind === "state" ? cameras : cameras.filter((p) => p.cmd !== "UPDATE"));
    }
    for (const table of STATES) expect((await t.columnsOf(`${table.name}_merged`)).map((x) => x.column_name), table.name).toEqual([...SYSTEM, ...Object.keys(table.cols), ...MERGE_COLUMNS]);
    expect(await t.columnsOf("road_weather_forecast_merged")).toEqual([]);
    const g = await t.grants([...TABLES.map((x) => x.name), ...STATES.map((x) => `${x.name}_merged`), "speed_cameras", "speed_cameras_merged"]);
    for (const table of STATES) {
      expect(g.get(table.name), table.name).toEqual(g.get("speed_cameras"));
      expect(g.get(`${table.name}_merged`), table.name).toEqual(g.get("speed_cameras_merged"));
    }
    expect(g.get("road_weather_forecast")).toEqual(["viafrei_ingestor:INSERT,SELECT"]);
    const r = await t.readable([...TABLES.map((x) => `domains.${x.name}`), ...STATES.map((x) => `domains.${x.name}_merged`)]);
    expect(r.checked).toBe(5 * (TABLES.length + STATES.length));
    expect(r.open).toEqual([]);
  });

  it("partitions the forecast by day with no default partition, and records its one-day window with no archive", async () => {
    const key = await t.pool.query<{ k: string }>("select pg_get_partkeydef('domains.road_weather_forecast'::regclass) as k");
    expect(key.rows[0]?.k).toBe("RANGE (observed_at)");
    const kids = await t.pool.query<{ bound: string }>(
      "select pg_get_expr(k.relpartbound, k.oid) as bound from pg_inherits i join pg_class k on k.oid = i.inhrelid where i.inhparent = 'domains.road_weather_forecast'::regclass",
    );
    expect(kids.rows.length).toBe(34);
    expect(kids.rows.filter((x) => x.bound === "DEFAULT")).toEqual([]);
    const r = await t.pool.query("select keep_days, archive from partition_retention where schema_name = 'domains' and table_name = 'road_weather_forecast'");
    expect(r.rows).toEqual([{ keep_days: 1, archive: false }]);
  });

  it("takes a row into each state table through the ingestor's upsert, and an unchanged one moves no row", async () => {
    for (const [name, row] of [
      ["weather_warnings", WARNING],
      ["weather_warnings_en", ENGLISH],
      ["road_weather_stations", STATION],
    ] as const) {
      await t.asSource(src(name), async (c) => {
        expect((await upsert(c, byName(name), [row])).rows, name).toEqual([{ inserted: true }]);
        expect((await upsert(c, byName(name), [row])).rows, name).toEqual([]);
        const back = (await c.query<Record<string, unknown>>(`select * from domains.${name}`)).rows[0] ?? {};
        for (const k of Object.keys(byName(name).cols)) {
          const want = row[k] ?? null;
          const got = back[k] instanceof Date ? back[k].toISOString() : back[k];
          expect(got, `${name}.${k}`).toEqual(typeof want === "string" && /^\d{4}-\d\d-\d\dT/.test(want) ? new Date(want).toISOString() : want);
        }
      });
    }
  });

  it("joins a German warning to its English text by content, as the old function does", async () => {
    await t.planted(async (c) => {
      await c.query("select set_config('viafrei.source_id', $1, true)", [src("weather_warnings")]);
      await upsert(c, byName("weather_warnings"), [WARNING, { ...WARNING, external_id: "2.49.0.0.276.0.DWD.PVW.2:808113000:1", identifier: "2.49.0.0.276.0.DWD.PVW.2", warncell_id: "808113000", version: 1 }]);
      await c.query("select set_config('viafrei.source_id', $1, true)", [src("weather_warnings_en")]);
      await upsert(c, byName("weather_warnings_en"), [ENGLISH, { ...ENGLISH, external_id: `X:${SHA("d")}`, identifier: "X", content_sha256: SHA("d"), event_ii: "85" }]);
      const r = await c.query<{ identifier: string; en: string | null }>(
        `select w.identifier, e.headline as en
           from domains.weather_warnings w
           left join lateral (
             select e.headline from domains.weather_warnings_en e
              where e.closed_at is null and e.sent_at = w.published_at and e.valid_from = w.valid_from
                and e.valid_to is not distinct from w.valid_to and e.warncell_ids ? w.warncell_id and e.event_ii = w.event_code_ii
              order by e.sent_at desc nulls last limit 1) e on true
          where w.closed_at is null order by 1`,
      );
      expect(r.rows).toEqual([
        { identifier: "2.49.0.0.276.0.DWD.PVW.1", en: "Official WARNING of SLIPPERY ROADS" },
        { identifier: "2.49.0.0.276.0.DWD.PVW.2", en: null },
      ]);
    });
  });

  it("closes a superseded version with its reason, and lets the ordinary close leave the reason empty", async () => {
    await t.asSource(src("weather_warnings"), async (c) => {
      await upsert(c, byName("weather_warnings"), [WARNING]);
      await c.query("update domains.weather_warnings set closed_at = clock_timestamp(), closed_reason = 'superseded'");
      await upsert(c, byName("weather_warnings"), [{ ...WARNING, external_id: "2.49.0.0.276.0.DWD.PVW.1:808111000:3", version: 3, level: 3 }]);
      await c.query("update domains.weather_warnings set closed_at = clock_timestamp() where version = 3");
      const r = await c.query<{ version: number; reason: string | null; open: boolean }>("select version, closed_reason as reason, closed_at is null as open from domains.weather_warnings order by version");
      expect(r.rows).toEqual([
        { version: 2, reason: "superseded", open: false },
        { version: 3, reason: null, open: false },
      ]);
    });
  });

  it("appends forecast runs: a repeat is a no-op, the next run is new rows, the newest run of a station is read through its index", async () => {
    await t.asSource(src("road_weather_forecast"), async (c) => {
      const run1 = [POINT(at(60), at(-30), at(-10)), POINT(at(120), at(-30), at(-10))];
      expect((await append(c, run1)).rows).toEqual([{ inserted: true }, { inserted: true }]);
      expect((await append(c, run1)).rows).toEqual([]);
      const run2 = [POINT(at(60), at(30), at(50)), POINT(at(120), at(30), at(50))].map((p) => ({ ...p, rc: 4 }));
      expect((await append(c, run2)).rows).toEqual([{ inserted: true }, { inserted: true }]);
      const newest = await c.query<{ n: number; rc: number }>(
        `select count(*)::int as n, min(rc) as rc from domains.road_weather_forecast
          where station_id = 'S-1' and observed_at = (select max(observed_at) from domains.road_weather_forecast where station_id = 'S-1')`,
      );
      expect(newest.rows).toEqual([{ n: 2, rc: 4 }]);
      await c.query("savepoint s");
      expect((await refusal(c.query("update domains.road_weather_forecast set rc = 1")))?.code).toBe("42501");
      await c.query("rollback to savepoint s");
    });
    await t.planted(async (c) => {
      await c.query(
        `insert into domains.road_weather_forecast (source_id, external_id, observed_at, station_id, valid_at, run_at)
         select 'road-weather-forecast-a', 'S' || (g % 400) || ':' || g, now() - (g % 20) * interval '1 hour', 'S' || (g % 400), now() + g * interval '1 minute', now()
           from generate_series(1, 8000) g`,
      );
      await c.query("analyze domains.road_weather_forecast");
      await c.query("set local enable_seqscan = off");
      const plan = (await c.query<{ "QUERY PLAN": string }>(
        "explain select valid_at, rc, ts from domains.road_weather_forecast where station_id = 'S42' and observed_at > now() - interval '3 hours' order by observed_at desc, valid_at",
      )).rows.map((x) => x["QUERY PLAN"]).join("\n");
      expect(plan).toMatch(/Index Scan (using )?road_weather_forecast_\d+_station_id_observed_at_valid/);
      expect(plan).not.toMatch(/Seq Scan/);
    });
  });

  it("refuses what the old tables refused, and a key that disagrees with its parts", async () => {
    const cases: [string, Row, string, string][] = [
      ["weather_warnings", { ...WARNING, external_id: "x" }, "23514", "weather_warnings_external_id_shape"],
      ["weather_warnings", { ...WARNING, level: 5 }, "23514", "weather_warnings_level"],
      ["weather_warnings", { ...WARNING, level: null }, "23502", "level"],
      ["weather_warnings", { ...WARNING, level_source: "guessed" }, "23514", "weather_warnings_level_source"],
      ["weather_warnings", { ...WARNING, official_sha256: "abc" }, "23514", "weather_warnings_hash"],
      ["weather_warnings", { ...WARNING, area_sha256: SHA("B") }, "23514", "weather_warnings_area_hash"],
      ["weather_warnings", { ...WARNING, valid_to: "2026-11-15T17:00:00Z" }, "23514", "weather_warnings_window"],
      ["weather_warnings", { ...WARNING, valid_from: null }, "23502", "valid_from"],
      ["weather_warnings", { ...WARNING, geom_wkt: "POINT(9 48)" }, "23514", "weather_warnings_geom_area"],
      ["weather_warnings", { ...WARNING, closed_reason: "superseded" }, "23514", "weather_warnings_closed_reason"],
      ["weather_warnings_en", { ...ENGLISH, external_id: "x" }, "23514", "weather_warnings_en_external_id_shape"],
      ["weather_warnings_en", { ...ENGLISH, language: "" }, "23514", "weather_warnings_en_language"],
      ["weather_warnings_en", { ...ENGLISH, warncell_ids: "808111000" }, "23514", "weather_warnings_en_warncell_ids_array"],
      ["weather_warnings_en", { ...ENGLISH, geom_wkt: "POINT(9 48)" }, "23514", "weather_warnings_en_geom_none"],
      ["weather_warnings_en", { ...ENGLISH, valid_to: "2026-11-15T17:00:00Z" }, "23514", "weather_warnings_en_window"],
      ["road_weather_stations", { ...STATION, segment_type: 3 }, "23514", "road_weather_stations_segment"],
      ["road_weather_stations", { ...STATION, surface: 0 }, "23514", "road_weather_stations_surface"],
      ["road_weather_stations", { ...STATION, name: null }, "23502", "name"],
      ["road_weather_stations", { ...STATION, geom_wkt: "LINESTRING(9 48, 9.1 48.1)" }, "23514", "road_weather_stations_geom_point"],
    ];
    for (const [name, row, code, word] of cases) {
      await t.asSource(src(name), async (c) => {
        const e = await refusal(upsert(c, byName(name), [row]));
        expect(e?.code, word).toBe(code);
        expect(e?.message, word).toContain(word);
      });
    }
    for (const [row, code, word] of [
      [{ ...POINT(at(60), at(-30), at(-10)), rc: 7 }, "23514", "road_weather_forecast_rc"],
      [{ ...POINT(at(60), at(-30), at(-10)), run_at: null }, "23502", "run_at"],
      [{ ...POINT(at(60), at(-30), at(-10)), geom_wkt: "POINT(9 48)" }, "23514", "road_weather_forecast_geom_none"],
      [POINT(at(60), at(-30), at(365 * 24 * 60)), "23514", "no partition of relation"],
    ] as const) {
      await t.asSource(src("road_weather_forecast"), async (c) => {
        const e = await refusal(append(c, [row]));
        expect(e?.code, word).toBe(code);
        expect(e?.message, word).toContain(word);
      });
    }
    await t.asSource("cameras-only", async (c) => {
      expect((await refusal(upsert(c, byName("weather_warnings"), [WARNING])))?.code).toBe("42501");
    });
  });

  it("leaves the old tables, the English join and the readers' area view as the baseline made them", async () => {
    for (const table of ["weather_warnings", "weather_warnings_en", "road_weather_stations", "road_weather_forecast"]) {
      const a = await t.baselineAgreement(table);
      expect(a.baseline.columns.length, table).toBeGreaterThan(5);
      expect(a.catalogue, table).toEqual(a.baseline);
    }
    const g = await t.pool.query<{ r: string; ok: boolean }>(
      `select r, has_table_privilege(r, 'public.weather_warnings_area_live', 'select') and has_function_privilege(r, 'public.weather_warning_english(bigint)', 'execute') as ok
         from unnest(array['viafrei_digest']) r order by 1`,
    );
    expect(g.rows).toEqual([{ r: "viafrei_digest", ok: true }]);
    expect((await t.pool.query("select * from public.weather_warnings_area_live limit 0")).fields.map((f) => f.name)).toContain("en_headline");
  });
});
