/**
 * The parking domains against a real catalogue: four facility tables, three
 * occupancy tick tables and the street bays with their state, each compared
 * with domains.speed_cameras; the licence pairs kept apart; the day partitions
 * and retention rows of the partitioned ticks and the unpartitioned ODbL
 * ticks; the writes the ingestor role makes; and the old tables left as the
 * baseline made them.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { appendSql, DomainDb, MERGE_COLUMNS, refusal, SYSTEM, upsertSql } from "./domain-db.js";
import { expectSystemThenDomainColumns, expectTickShape } from "./domain-expect.js";

const url = process.env["TEST_DATABASE_URL"];
const required = process.env["VF_REQUIRE_DB"] === "1";

if (url === undefined && required) {
  describe("the parking domains", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the parking test did not run");
    });
  });
}

type Cols = Readonly<Record<string, string>>;
const TZ = "timestamp with time zone";
const FULL: Cols = {
  kind: "text",
  name: "text",
  operator: "text",
  road: "text",
  capacity_total: "integer",
  capacity_truck: "integer",
  capacity_disabled: "integer",
  address: "jsonb",
  opening: "jsonb",
  confidentiality: "text",
};
const AMENITY: Cols = { facilities: "jsonb", facilities_absent: "jsonb", facilities_source: "text" };
const TAIL: Cols = { source_publisher: "text", provider_updated_at: TZ, last_seen_at: TZ };
const FACILITIES: Cols = { ...FULL, ...AMENITY, ...TAIL };
const PLAIN: Cols = { ...FULL, ...TAIL };
const SID: Cols = { kind: "text", name: "text", capacity_total: "integer", capacity_truck: "integer", address: "jsonb", confidentiality: "text", ...AMENITY, ...TAIL };
const OCC: Cols = {
  spaces_free: "integer",
  spaces_total: "integer",
  occupancy_pct: "numeric",
  status: "text",
  feed_ts: TZ,
  confidentiality: "text",
  implausible_fields: "jsonb",
  source_run_id: "bigint",
};
const BAYS: Cols = {
  kind: "text",
  publisher_kind: "text",
  street: "text",
  house_number: "text",
  postcode: "text",
  city: "text",
  charge_point_operator: "text",
  spaces: "integer",
  reserved_when: "text",
  source_publisher: "text",
  provider_updated_at: TZ,
};
const STATE: Cols = { state: "text", message_at: TZ, source_publisher: "text", provider_updated_at: TZ };

type Kind = "state" | "tick";
type Table = { name: string; cols: Cols; kind: Kind; required: readonly string[]; defaults?: Readonly<Record<string, string>>; own: readonly string[]; partitioned?: boolean };
const AMENITY_DEFAULTS = { facilities: "'[]'::jsonb", facilities_absent: "'[]'::jsonb" };
const FAC_OWN = (t: string, full: boolean, amenity: boolean): string[] => [
  `c ${t}_address_object CHECK (((address IS NULL) OR (jsonb_typeof(address) = 'object'::text)))`,
  full
    ? `c ${t}_capacity CHECK (((COALESCE(capacity_total, 0) >= 0) AND (COALESCE(capacity_truck, 0) >= 0) AND (COALESCE(capacity_disabled, 0) >= 0)))`
    : `c ${t}_capacity CHECK (((COALESCE(capacity_total, 0) >= 0) AND (COALESCE(capacity_truck, 0) >= 0)))`,
  ...(amenity
    ? [
        `c ${t}_facilities_absent_vocabulary`,
        `c ${t}_facilities_disjoint CHECK ((NOT (facilities ?| domains.jsonb_texts(facilities_absent))))`,
        `c ${t}_facilities_source CHECK (((facilities_source IS NULL) = ((facilities = '[]'::jsonb) AND (facilities_absent = '[]'::jsonb))))`,
        `c ${t}_facilities_source_nonempty CHECK (((facilities_source IS NULL) OR (facilities_source <> ''::text)))`,
        `c ${t}_facilities_vocabulary`,
      ]
    : []),
  `c ${t}_geom_point CHECK (((geom IS NULL) OR (geometrytype(geom) = 'POINT'::text)))`,
  `c ${t}_kind CHECK ((kind = ANY (ARRAY['rest_area'::text, 'car_park'::text, 'park_and_ride'::text, 'truck'::text, 'other'::text])))`,
];
const OCC_OWN = (t: string, partitioned: boolean): string[] => {
  const on = partitioned ? "ON ONLY" : "ON";
  return [
    `CREATE INDEX ${t}_brin ${on} domains.${t} USING brin (observed_at)`,
    `CREATE INDEX ${t}_facility ${on} domains.${t} USING btree (external_id, observed_at DESC)`,
    `c ${t}_counts CHECK (((COALESCE(spaces_free, 0) >= 0) AND (COALESCE(spaces_total, 0) >= 0)))`,
    `c ${t}_geom_point CHECK (((geom IS NULL) OR (geometrytype(geom) = 'POINT'::text)))`,
    `c ${t}_implausible`,
    `c ${t}_pct CHECK (((occupancy_pct IS NULL) OR (occupancy_pct >= (0)::numeric)))`,
  ];
};
const TABLES: readonly Table[] = [
  { name: "parking_facilities", cols: FACILITIES, kind: "state", required: ["kind", "facilities", "facilities_absent"], defaults: AMENITY_DEFAULTS, own: FAC_OWN("parking_facilities", true, true) },
  { name: "parking_facilities_bysa", cols: PLAIN, kind: "state", required: ["kind"], own: FAC_OWN("parking_facilities_bysa", true, false) },
  { name: "parking_facilities_odbl", cols: PLAIN, kind: "state", required: ["kind"], own: FAC_OWN("parking_facilities_odbl", true, false) },
  { name: "parking_facilities_sid", cols: SID, kind: "state", required: ["kind", "facilities", "facilities_absent"], defaults: AMENITY_DEFAULTS, own: FAC_OWN("parking_facilities_sid", false, true) },
  { name: "parking_occupancy", cols: OCC, kind: "tick", required: [], own: OCC_OWN("parking_occupancy", true), partitioned: true },
  { name: "parking_occupancy_odbl", cols: OCC, kind: "tick", required: [], own: OCC_OWN("parking_occupancy_odbl", false), partitioned: false },
  { name: "parking_occupancy_sid", cols: OCC, kind: "tick", required: [], own: OCC_OWN("parking_occupancy_sid", true), partitioned: true },
  {
    name: "street_bays",
    cols: BAYS,
    kind: "state",
    required: ["kind"],
    own: [
      "c street_bays_geom_point CHECK (((geom IS NULL) OR (geometrytype(geom) = 'POINT'::text)))",
      "c street_bays_kind CHECK ((kind = ANY (ARRAY['disabled'::text, 'ev_charging'::text, 'loading'::text, 'regular'::text, 'unspecified'::text])))",
      "c street_bays_postcode CHECK (((postcode IS NULL) OR (postcode ~ '^[0-9]{5}$'::text)))",
      "c street_bays_spaces CHECK (((spaces IS NULL) OR ((spaces >= 1) AND (spaces <= 99))))",
    ],
  },
  {
    name: "street_bay_state",
    cols: STATE,
    kind: "state",
    required: ["state", "message_at"],
    own: ["c street_bay_state_geom_point CHECK (((geom IS NULL) OR (geometrytype(geom) = 'POINT'::text)))", "c street_bay_state_known CHECK ((state = ANY (ARRAY['free'::text, 'occupied'::text])))"],
  },
];
const STATES = TABLES.filter((x) => x.kind === "state");
const TICKS = TABLES.filter((x) => x.kind === "tick");

type Row = { external_id: string; match_key?: string | null; observed_at?: string | null; geom_wkt?: string | null } & Record<string, unknown>;

describe.skipIf(url === undefined)("the parking domains", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "parking");

  beforeAll(async () => {
    await t.make([
      ...TABLES.map((x) => [`${x.name.replaceAll("_", "-")}-a`, x.name, 60] as const),
      ["parking-facilities-b", "parking_facilities", 20],
      ["cameras-only", "speed_cameras", 50],
    ]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  const src = (table: string): string => `${table.replaceAll("_", "-")}-a`;
  const upsert = (c: pg.PoolClient, table: Table, source: string, rows: Row[]): Promise<pg.QueryResult<{ inserted: boolean }>> =>
    c.query<{ inserted: boolean }>(upsertSql(`domains.${table.name}`, table.cols), [JSON.stringify(rows), source, "default"]);
  const append = (c: pg.PoolClient, table: Table, source: string, rows: Row[]): Promise<pg.QueryResult<{ inserted: boolean }>> =>
    c.query<{ inserted: boolean }>(appendSql(`domains.${table.name}`, table.cols), [JSON.stringify(rows), source, "default"]);
  const byName = (n: string): Table => {
    const x = TABLES.find((y) => y.name === n);
    if (x === undefined) throw new Error(n);
    return x;
  };

  const now = new Date();
  const at = (minutes: number): string => new Date(now.getTime() + minutes * 60_000).toISOString();
  const FACILITY: Row = {
    external_id: "P-1",
    geom_wkt: "POINT(8.6821 50.1109)",
    kind: "truck",
    name: "Rastanlage Musterwald",
    operator: "Ein Betreiber",
    road: "A5",
    capacity_total: 120,
    capacity_truck: 80,
    capacity_disabled: 4,
    address: { street: "Raststätte 1", postcode: "60549", city: "Frankfurt am Main" },
    opening: { always: true },
    confidentiality: "noRestriction",
    facilities: ["toilet", "shower"],
    facilities_absent: ["wifi"],
    facilities_source: "publisher",
    source_publisher: "Ein Verbund",
    provider_updated_at: "2026-11-10T08:00:00Z",
    last_seen_at: "2026-11-14T08:00:00Z",
  };
  const fit = (table: Table, row: Row): Row => Object.fromEntries(Object.entries(row).filter(([k]) => k in table.cols || ["external_id", "geom_wkt", "match_key", "observed_at"].includes(k))) as Row;
  const TICK: Row = { external_id: "P-1", observed_at: at(0), spaces_free: 12, spaces_total: 80, occupancy_pct: 85, status: "spacesAvailable", feed_ts: at(-1), confidentiality: "noRestriction", implausible_fields: null, source_run_id: 7 };
  const BAY: Row = {
    external_id: "B-1",
    geom_wkt: "POINT(7.4653 51.5136)",
    kind: "disabled",
    publisher_kind: "Behindertenparkplatz",
    street: "Musterstraße",
    house_number: "3",
    postcode: "44135",
    city: "Dortmund",
    charge_point_operator: null,
    spaces: 2,
    reserved_when: "Mo-Fr 8-18",
    source_publisher: "Eine Stadt",
    provider_updated_at: "2026-11-10T08:00:00Z",
  };
  const BAY_STATE: Row = { external_id: "B-1", state: "occupied", message_at: "2026-11-14T08:00:00Z", source_publisher: "Eine Stadt", provider_updated_at: "2026-11-14T08:00:01Z" };
  const sample = (table: Table): Row => (table.name === "street_bays" ? BAY : table.name === "street_bay_state" ? BAY_STATE : table.kind === "tick" ? TICK : fit(table, FACILITY));

  it("is applied", async () => {
    expect((await t.pool.query("select 1 from schema_migrations where version = 299 and name = '0299_domain_parking.sql'")).rowCount).toBe(1);
  });

  it("has the system columns of speed_cameras, then the domain columns, each in a type a writer declares", async () => {
    await expectSystemThenDomainColumns(t, TABLES);
  });

  it("has the constraints and indexes of the convention, and each table its own", async () => {
    const model = await t.convention();
    for (const table of TABLES) {
      const shape = (await t.shape(table.name)).map((d) => d.replaceAll(table.name, "T"));
      const own = table.own.map((d) => d.replaceAll(table.name, "T"));
      const matches = (d: string, o: string): boolean => d === o || (!o.includes(" CHECK ") && !o.startsWith("CREATE") && d.startsWith(`${o} CHECK `));
      const isOwn = (d: string): boolean => own.some((o) => matches(d, o));
      for (const o of own) expect(shape.filter((d) => matches(d, o)), `${table.name}: ${o}`).toHaveLength(1);
      const rest = shape.filter((d) => !isOwn(d));
      if (table.kind === "state") {
        expect(rest, table.name).toEqual(model);
      } else {
        expectTickShape(rest, model, table.name, table.partitioned === true ? "ON ONLY" : "ON");
      }
    }
  });

  it("enables and forces row-level security; the state tables have the policies of speed_cameras, the ticks no update policy", async () => {
    const cameras = await t.policies("speed_cameras");
    for (const table of TABLES) {
      expect(await t.rls(table.name), table.name).toEqual({ e: true, f: true });
      expect(await t.policies(table.name), table.name).toEqual(table.kind === "state" ? cameras : cameras.filter((p) => p.cmd !== "UPDATE"));
    }
  });

  it("has a merged view for each state table and none for a tick table", async () => {
    for (const table of STATES) expect((await t.columnsOf(`${table.name}_merged`)).map((x) => x.column_name), table.name).toEqual([...SYSTEM, ...Object.keys(table.cols), ...MERGE_COLUMNS]);
    for (const table of TICKS) expect(await t.columnsOf(`${table.name}_merged`), table.name).toEqual([]);
  });

  it("grants the ingestor what speed_cameras grants on a state table, select and insert on a tick table, and no reader anything — the gated pair included", async () => {
    const rels = [...TABLES.map((x) => x.name), ...STATES.map((x) => `${x.name}_merged`), "speed_cameras", "speed_cameras_merged"];
    const g = await t.grants(rels);
    for (const table of STATES) {
      expect(g.get(table.name), table.name).toEqual(g.get("speed_cameras"));
      expect(g.get(`${table.name}_merged`), table.name).toEqual(g.get("speed_cameras_merged"));
    }
    for (const table of TICKS) expect(g.get(table.name), table.name).toEqual(["viafrei_ingestor:INSERT,SELECT"]);
    const r = await t.readable([...TABLES.map((x) => `domains.${x.name}`), ...STATES.map((x) => `domains.${x.name}_merged`)]);
    expect(r.checked).toBe(5 * (TABLES.length + STATES.length));
    expect(r.open).toEqual([]);
  });

  it("partitions the two daily ticks by day with no default partition and a retention row, and leaves the ODbL ticks whole", async () => {
    for (const table of TICKS) {
      const key = await t.pool.query<{ k: string | null }>(`select pg_get_partkeydef('domains.${table.name}'::regclass) as k`);
      expect(key.rows[0]?.k, table.name).toBe(table.partitioned === true ? "RANGE (observed_at)" : null);
      const kids = await t.pool.query<{ name: string; bound: string }>(
        `select k.relname as name, pg_get_expr(k.relpartbound, k.oid) as bound from pg_inherits i join pg_class k on k.oid = i.inhrelid where i.inhparent = 'domains.${table.name}'::regclass`,
      );
      expect(kids.rows.filter((x) => x.bound === "DEFAULT"), table.name).toEqual([]);
      expect(kids.rows.length, table.name).toBe(table.partitioned === true ? 34 : 0);
    }
    const r = await t.pool.query<{ table_name: string; keep_days: number; archive: boolean }>(
      "select table_name, keep_days, archive from partition_retention where schema_name = 'domains' and table_name like 'parking%' order by 1",
    );
    expect(r.rows).toEqual([
      { table_name: "parking_occupancy", keep_days: 14, archive: true },
      { table_name: "parking_occupancy_sid", keep_days: 14, archive: true },
    ]);
  });

  it("takes one row into each state table through the ingestor's upsert, and an unchanged one moves no row", async () => {
    for (const table of STATES) {
      await t.asSource(src(table.name), async (c) => {
        const row = sample(table);
        expect((await upsert(c, table, src(table.name), [row])).rows, table.name).toEqual([{ inserted: true }]);
        expect((await upsert(c, table, src(table.name), [row])).rows, table.name).toEqual([]);
        const back = (await c.query<Record<string, unknown>>(`select * from domains.${table.name}`)).rows[0] ?? {};
        for (const k of Object.keys(table.cols)) {
          const want = row[k] ?? null;
          const got = back[k] instanceof Date ? back[k].toISOString() : back[k];
          expect(got, `${table.name}.${k}`).toEqual(typeof want === "string" && /^\d{4}-\d\d-\d\dT/.test(want) ? new Date(want).toISOString() : want);
        }
      });
    }
  });

  it("appends ticks to each occupancy table: a repeat is a no-op, a later one a new row, and nothing is updated", async () => {
    for (const table of TICKS) {
      await t.asSource(src(table.name), async (c) => {
        expect((await append(c, table, src(table.name), [TICK])).rows, table.name).toEqual([{ inserted: true }]);
        expect((await append(c, table, src(table.name), [TICK])).rows, table.name).toEqual([]);
        expect((await append(c, table, src(table.name), [{ ...TICK, observed_at: at(5), spaces_free: 3, occupancy_pct: 96.25 }])).rows, table.name).toEqual([{ inserted: true }]);
        const r = await c.query<{ free: number; pct: string }>(`select spaces_free as free, occupancy_pct::text as pct from domains.${table.name} order by observed_at`);
        expect(r.rows, table.name).toEqual([
          { free: 12, pct: "85.00" },
          { free: 3, pct: "96.25" },
        ]);
        await c.query("savepoint s");
        expect((await refusal(c.query(`update domains.${table.name} set status = 'x'`)))?.code, table.name).toBe("42501");
        await c.query("rollback to savepoint s");
      });
    }
  });

  it("keeps the licence pairs apart: a source registered for one parking domain cannot write another", async () => {
    await t.asSource(src("parking_facilities"), async (c) => {
      for (const other of ["parking_facilities_bysa", "parking_facilities_odbl", "parking_facilities_sid"]) {
        await c.query("savepoint s");
        expect((await refusal(upsert(c, byName(other), src("parking_facilities"), [fit(byName(other), FACILITY)])))?.code, other).toBe("42501");
        await c.query("rollback to savepoint s");
      }
    });
    await t.asSource(src("parking_occupancy"), async (c) => {
      for (const other of ["parking_occupancy_odbl", "parking_occupancy_sid"]) {
        await c.query("savepoint s");
        expect((await refusal(append(c, byName(other), src("parking_occupancy"), [TICK])))?.code, other).toBe("42501");
        await c.query("rollback to savepoint s");
      }
    });
    await t.asSource("cameras-only", async (c) => {
      expect((await refusal(upsert(c, byName("parking_facilities"), "cameras-only", [FACILITY])))?.code).toBe("42501");
    });
    await t.asSource(null, async (c) => {
      expect((await refusal(append(c, byName("parking_occupancy"), src("parking_occupancy"), [TICK])))?.code).toBe("42501");
    });
  });

  it("refuses what the old tables refused, by constraint name", async () => {
    const cases: [string, Row, string, string][] = [
      ["parking_facilities", { ...FACILITY, kind: "garage" }, "23514", "parking_facilities_kind"],
      ["parking_facilities", { ...FACILITY, kind: null }, "23502", "kind"],
      ["parking_facilities", { ...FACILITY, capacity_total: -1 }, "23514", "parking_facilities_capacity"],
      ["parking_facilities", { ...FACILITY, address: "Raststätte 1" }, "23514", "parking_facilities_address_object"],
      ["parking_facilities", { ...FACILITY, geom_wkt: "LINESTRING(8 50, 8.1 50.1)" }, "23514", "parking_facilities_geom_point"],
      ["parking_facilities", { ...FACILITY, facilities: ["sauna"] }, "23514", "parking_facilities_facilities_vocabulary"],
      ["parking_facilities", { ...FACILITY, facilities: { toilet: true } }, "23514", "parking_facilities_facilities_vocabulary"],
      ["parking_facilities", { ...FACILITY, facilities_absent: ["sauna"] }, "23514", "parking_facilities_facilities_absent_vocabulary"],
      ["parking_facilities", { ...FACILITY, facilities_absent: ["toilet"] }, "23514", "parking_facilities_facilities_disjoint"],
      ["parking_facilities", { ...FACILITY, facilities_source: null }, "23514", "parking_facilities_facilities_source"],
      ["parking_facilities", { ...FACILITY, facilities: [], facilities_absent: [] }, "23514", "parking_facilities_facilities_source"],
      ["parking_facilities", { ...FACILITY, facilities_source: "" }, "23514", "parking_facilities_facilities_source_nonempty"],
      ["parking_facilities", { ...FACILITY, facilities: null }, "23502", "facilities"],
      ["parking_facilities", { ...FACILITY, external_id: "" }, "23514", "parking_facilities_external_id_check"],
      ["parking_facilities_sid", { ...fit(byName("parking_facilities_sid"), FACILITY), facilities_absent: ["shower"] }, "23514", "parking_facilities_sid_facilities_disjoint"],
      ["parking_facilities_bysa", { ...fit(byName("parking_facilities_bysa"), FACILITY), capacity_disabled: -1 }, "23514", "parking_facilities_bysa_capacity"],
      ["parking_facilities_odbl", { ...fit(byName("parking_facilities_odbl"), FACILITY), kind: "garage" }, "23514", "parking_facilities_odbl_kind"],
      ["street_bays", { ...BAY, kind: "taxi" }, "23514", "street_bays_kind"],
      ["street_bays", { ...BAY, postcode: "D-44135" }, "23514", "street_bays_postcode"],
      ["street_bays", { ...BAY, spaces: 0 }, "23514", "street_bays_spaces"],
      ["street_bays", { ...BAY, spaces: 100 }, "23514", "street_bays_spaces"],
      ["street_bay_state", { ...BAY_STATE, state: "unknown" }, "23514", "street_bay_state_known"],
      ["street_bay_state", { ...BAY_STATE, message_at: null }, "23502", "message_at"],
    ];
    for (const [name, row, code, word] of cases) {
      await t.asSource(src(name), async (c) => {
        const e = await refusal(upsert(c, byName(name), src(name), [row]));
        expect(e?.code, word).toBe(code);
        expect(e?.message, word).toContain(word);
      });
    }
    const ticks: [string, Row, string, string][] = [
      ["parking_occupancy", { ...TICK, spaces_free: -1 }, "23514", "parking_occupancy_counts"],
      ["parking_occupancy", { ...TICK, occupancy_pct: -0.5 }, "23514", "parking_occupancy_pct"],
      ["parking_occupancy", { ...TICK, implausible_fields: [] }, "23514", "parking_occupancy_implausible"],
      ["parking_occupancy", { ...TICK, implausible_fields: ["status"] }, "23514", "parking_occupancy_implausible"],
      ["parking_occupancy", { ...TICK, observed_at: at(365 * 24 * 60) }, "23514", "no partition of relation"],
      ["parking_occupancy_sid", { ...TICK, observed_at: at(365 * 24 * 60) }, "23514", "no partition of relation"],
      ["parking_occupancy_odbl", { ...TICK, implausible_fields: { pct: true } }, "23514", "parking_occupancy_odbl_implausible"],
    ];
    for (const [name, row, code, word] of ticks) {
      await t.asSource(src(name), async (c) => {
        const e = await refusal(append(c, byName(name), src(name), [row]));
        expect(e?.code, word).toBe(code);
        expect(e?.message, word).toContain(word);
      });
    }
    // A flagged reading is kept, and an occupancy above 100 % is not refused: the flag says it is implausible.
    await t.asSource(src("parking_occupancy"), async (c) => {
      expect((await append(c, byName("parking_occupancy"), src("parking_occupancy"), [{ ...TICK, occupancy_pct: 140, implausible_fields: ["occupancy_pct"] }])).rows).toEqual([{ inserted: true }]);
    });
    // The ODbL ticks are not partitioned: a tick a year ahead is kept, as in the old table.
    await t.asSource(src("parking_occupancy_odbl"), async (c) => {
      expect((await append(c, byName("parking_occupancy_odbl"), src("parking_occupancy_odbl"), [{ ...TICK, observed_at: at(365 * 24 * 60) }])).rows).toEqual([{ inserted: true }]);
    });
  });

  it("finds a facility's newest occupancy through the facility index", async () => {
    await t.planted(async (c) => {
      await c.query(
        `insert into domains.parking_occupancy (source_id, external_id, observed_at, spaces_free)
         select 'parking-occupancy-a', 'P' || (g % 500), now() - (g % 48) * interval '1 hour', g % 50 from generate_series(1, 6000) g`,
      );
      await c.query("analyze domains.parking_occupancy");
      await c.query("set local enable_seqscan = off");
      const plan = (await c.query<{ "QUERY PLAN": string }>(
        "explain select spaces_free, observed_at from domains.parking_occupancy where external_id = 'P42' and observed_at > now() - interval '2 hours' order by observed_at desc limit 1",
      )).rows.map((x) => x["QUERY PLAN"]).join("\n");
      expect(plan).toMatch(/parking_occupancy_\d{8}_external_id_observed_at_idx/);
    });
  });

  it("merges open facilities by trust, then freshness", async () => {
    await t.planted(async (c) => {
      const plant = (source: string, id: string, observed: string): Promise<unknown> =>
        c.query("insert into domains.parking_facilities (source_id, external_id, match_key, observed_at, kind) values ($1, $2, 'K1', $3::timestamptz, 'truck')", [source, id, observed]);
      await plant("parking-facilities-a", "A", "2026-11-01T00:00:00Z");
      await plant("parking-facilities-b", "B", "2026-11-05T00:00:00Z");
      const r = await c.query<{ source_id: string; source_count: number }>("select source_id, source_count from domains.parking_facilities_merged where entity_key = 'K1'");
      expect(r.rows).toEqual([{ source_id: "parking-facilities-a", source_count: 2 }]);
    });
  });

  it("splits a JSON array into its strings for the checks, and anything else into nothing", async () => {
    const r = await t.pool.query<{ a: string[]; b: string[]; c: string[] | null }>(`select domains.jsonb_texts('["x","y"]') as a, domains.jsonb_texts('{"x":1}') as b, domains.jsonb_texts(null) as c`);
    expect(r.rows).toEqual([{ a: ["x", "y"], b: [], c: null }]);
  });

  it("leaves the old tables as the baseline made them: the same columns and constraints", async () => {
    for (const table of [
      "parking_facilities",
      "parking_facilities_bysa",
      "parking_facilities_odbl",
      "parking_facilities_sid",
      "parking_occupancy",
      "parking_occupancy_odbl",
      "parking_occupancy_sid",
      "street_bays",
      "street_bay_state",
      "street_bay_ticks",
    ]) {
      const a = await t.baselineAgreement(table);
      expect(a.baseline.columns.length, table).toBeGreaterThan(5);
      expect(a.catalogue, table).toEqual(a.baseline);
    }
  });
});
