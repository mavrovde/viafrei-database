/**
 * The road context layers, their version history and the traffic cameras as
 * domains, against a real catalogue: each compared with domains.speed_cameras;
 * the old kind and variant vocabulary refused and accepted as the old table
 * did; the generated anchor; the near read the old statement makes, made over
 * the new table through its indexes; and the old tables left as the baseline
 * made them.
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
  describe("the road context and webcam domains", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the road context test did not run");
    });
  });
}

type Cols = Readonly<Record<string, string>>;
const TZ = "timestamp with time zone";
const FEATURES: Cols = {
  kind: "text",
  variant: "text",
  name: "text",
  ref: "text",
  detail_text: "text",
  answerable: "boolean",
  props: "jsonb",
  content_hash: "text",
  source_publisher: "text",
  provider_updated_at: TZ,
  last_seen_at: TZ,
};
const VERSIONS: Cols = { content_hash: "text", props: "jsonb", source_run_id: "bigint" };
const CAMS: Cols = {
  location_label: "text",
  note: "text",
  road_number: "text",
  direction: "text",
  link_url: "text",
  source_publisher: "text",
  provider_updated_at: TZ,
  last_seen_at: TZ,
};

type Table = { name: string; cols: Cols; kind: "state" | "tick"; required: readonly string[]; defaults?: Readonly<Record<string, string>>; generated?: readonly string[]; own: readonly string[] };
const VARIANT =
  "c T_variant CHECK ((((kind = 'border_crossing'::text) AND (variant = ANY (ARRAY['motorway'::text, 'federal'::text, 'state'::text, 'district'::text, 'ferry'::text, 'other'::text]))) OR ((kind = 'traffic_signal'::text) AND (variant = ANY (ARRAY['acoustic'::text, 'plain'::text]))) OR ((kind = 'winter_service'::text) AND (variant = ANY (ARRAY['priority_1'::text, 'priority_2'::text, 'priority_3'::text, 'unranked'::text]))) OR ((kind = 'pedestrian_zone_access'::text) AND (variant = ANY (ARRAY['pedestrian_zone'::text, 'no_motor_vehicles'::text, 'no_entry'::text, 'no_cycling'::text, 'sign_not_listed'::text]))) OR ((kind = 'detour'::text) AND (variant = ANY (ARRAY['motor_vehicles'::text, 'lorries'::text, 'cars'::text, 'cycles'::text, 'all_traffic'::text, 'other'::text]))) OR ((kind = 'loading_zone'::text) AND (variant = ANY (ARRAY['load_deliver'::text, 'load_deliver_work'::text, 'alternating'::text, 'other'::text]))) OR ((kind = 'coach_parking'::text) AND (variant = ANY (ARRAY['parking'::text, 'stop_only'::text]))) OR ((kind = 'motorway_detour'::text) AND (variant = 'signed'::text)) OR ((kind = 'street_parking'::text) AND (variant = ANY (ARRAY['ticket'::text, 'disc'::text, 'unmanaged'::text, 'disabled'::text, 'ev_charging'::text, 'loading'::text, 'sharing'::text, 'disabled_personal'::text, 'restricted_stopping'::text, 'no_stopping'::text, 'unresolved'::text, 'other'::text]))) OR ((kind = 'signal_installation'::text) AND (variant = ANY (ARRAY['junction'::text, 'pedestrian_crossing'::text, 'other'::text])))))";
const TABLES: readonly Table[] = [
  {
    name: "road_context_features",
    cols: FEATURES,
    kind: "state",
    required: ["kind", "variant", "name", "props", "content_hash"],
    defaults: { props: "'{}'::jsonb" },
    generated: ["anchor"],
    own: [
      "CREATE INDEX T_kind_open ON domains.T USING btree (kind) WHERE (closed_at IS NULL)",
      "c T_content_hash CHECK ((content_hash <> ''::text))",
      "c T_kind CHECK ((kind = ANY (ARRAY['border_crossing'::text, 'traffic_signal'::text, 'winter_service'::text, 'pedestrian_zone_access'::text, 'detour'::text, 'loading_zone'::text, 'coach_parking'::text, 'motorway_detour'::text, 'street_parking'::text, 'signal_installation'::text])))",
      "c T_props_object CHECK ((jsonb_typeof(props) = 'object'::text))",
      VARIANT,
    ],
  },
  {
    name: "road_context_feature_versions",
    cols: VERSIONS,
    kind: "tick",
    required: ["content_hash", "props"],
    defaults: { props: "'{}'::jsonb" },
    own: [
      "CREATE INDEX T_brin ON domains.T USING brin (observed_at)",
      "c T_content_hash CHECK ((content_hash <> ''::text))",
      "c T_props_object CHECK ((jsonb_typeof(props) = 'object'::text))",
    ],
  },
  {
    name: "webcams",
    cols: CAMS,
    kind: "state",
    required: ["location_label"],
    own: [
      "c T_geom_point CHECK (((geom IS NULL) OR (geometrytype(geom) = 'POINT'::text)))",
      "c T_link_url CHECK (((link_url IS NULL) OR (link_url ~ '^https://'::text)))",
      "c T_location_label CHECK ((location_label <> ''::text))",
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

describe.skipIf(url === undefined)("the road context and webcam domains", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "roadctx");
  const src = (table: string): string => `${table.replaceAll("_", "-")}-a`;

  beforeAll(async () => {
    await t.make([...STATES.map((x) => [src(x.name), x.name, 60] as const), ["cameras-only", "speed_cameras", 50]]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  const upsert = (c: pg.PoolClient, table: Table, rows: Row[]): Promise<pg.QueryResult<{ inserted: boolean }>> =>
    c.query<{ inserted: boolean }>(upsertSql(`domains.${table.name}`, table.cols), [JSON.stringify(rows), src(table.name), "default"]);
  const append = (c: pg.PoolClient, rows: Row[]): Promise<pg.QueryResult<{ inserted: boolean }>> =>
    c.query<{ inserted: boolean }>(appendSql("domains.road_context_feature_versions", VERSIONS), [JSON.stringify(rows), src("road_context_features"), "default"]);

  const SIGNAL: Row = {
    external_id: "sig-1",
    geom_wkt: "POINT(10.0005 53.55)",
    kind: "traffic_signal",
    variant: "acoustic",
    name: "Musterstraße / Beispielweg",
    ref: null,
    detail_text: "Akustisches Signal",
    answerable: null,
    props: { bus_request: true },
    content_hash: "h1",
    source_publisher: "Eine Stadt",
    provider_updated_at: "2026-11-15T00:00:00Z",
    last_seen_at: "2026-11-15T00:05:00Z",
  };
  const DETOUR: Row = {
    ...SIGNAL,
    external_id: "det-1",
    geom_wkt: "LINESTRING(10 53.54, 10.01 53.54, 10.01 53.56)",
    kind: "detour",
    variant: "motor_vehicles",
    name: "Umleitung U 1",
    detail_text: null,
    props: { valid_from: "2026-11-01", valid_to: "2026-11-30" },
    content_hash: "h2",
  };
  const CAMERA: Row = {
    external_id: "cam-1",
    geom_wkt: "POINT(10 53.55)",
    location_label: "Brücke am Hafen",
    note: null,
    road_number: "A7",
    direction: "Nord",
    link_url: "https://example.org/cam/1",
    source_publisher: "Ein Betreiber",
    provider_updated_at: "2026-11-15T00:00:00Z",
    last_seen_at: "2026-11-15T00:05:00Z",
  };

  it("is applied", async () => {
    expect((await t.pool.query("select 1 from schema_migrations where version = 301 and name = '0301_domain_road_context_webcams.sql'")).rowCount).toBe(1);
  });

  it("has the system columns of speed_cameras, then the domain columns, each in a type a writer declares, and the generated anchor last", async () => {
    const cameras = (await t.columnsOf("speed_cameras")).slice(0, SYSTEM.length);
    for (const table of TABLES) {
      const mine = await t.columnsOf(table.name);
      expect(mine.map((x) => x.column_name), table.name).toEqual([...SYSTEM, ...Object.keys(table.cols), ...(table.generated ?? [])]);
      expect(mine.slice(0, SYSTEM.length), table.name).toEqual(cameras);
      for (const x of mine.slice(SYSTEM.length).filter((c) => !(table.generated ?? []).includes(c.column_name))) {
        const where = `${table.name}.${x.column_name}`;
        expect(x.data_type, where).toBe(table.cols[x.column_name]);
        expect(WRITER_TYPES.has(x.data_type), where).toBe(true);
        expect(x.is_nullable, where).toBe(table.required.includes(x.column_name) ? "NO" : "YES");
        expect(x.column_default, where).toBe(table.defaults?.[x.column_name] ?? null);
      }
    }
    const g = await t.pool.query<{ is_generated: string; expr: string; typ: string }>(
      `select c.is_generated, c.generation_expression as expr, format_type(a.atttypid, a.atttypmod) as typ
         from information_schema.columns c join pg_attribute a on a.attrelid = 'domains.road_context_features'::regclass and a.attname = c.column_name
        where c.table_schema = 'domains' and c.table_name = 'road_context_features' and c.column_name = 'anchor'`,
    );
    expect(g.rows).toEqual([{ is_generated: "ALWAYS", expr: "st_closestpoint(geom, st_centroid(geom))", typ: "geometry(Point,4326)" }]);
  });

  it("has the constraints and indexes of the convention, and each table its own", async () => {
    const model = await t.convention();
    for (const table of TABLES) {
      const shape = (await t.shape(table.name)).map((d) => d.replaceAll(table.name, "T"));
      expect(shape.filter((d) => table.own.includes(d)).sort(), table.name).toEqual([...table.own].sort());
      const rest = shape.filter((d) => !table.own.includes(d));
      if (table.kind === "state") {
        expect(rest, table.name).toEqual(model);
      } else {
        expect(rest.filter((d) => /T_(owner_key|pkey) /.test(d)), table.name).toEqual([
          "CREATE UNIQUE INDEX T_owner_key ON domains.T USING btree (source_id, feed, external_id, observed_at)",
          "CREATE UNIQUE INDEX T_pkey ON domains.T USING btree (id, observed_at)",
          "p T_pkey PRIMARY KEY (id, observed_at)",
          "u T_owner_key UNIQUE (source_id, feed, external_id, observed_at)",
        ]);
        expect(rest.filter((d) => !/T_(owner_key|pkey) /.test(d)), table.name).toEqual(model.filter((d) => !/T_(owner_key|pkey) /.test(d)));
      }
    }
  });

  it("has the policies, merged views and grants of the convention, and no reader anything", async () => {
    const cameras = await t.policies("speed_cameras");
    for (const table of TABLES) {
      expect(await t.rls(table.name), table.name).toEqual({ e: true, f: true });
      // The version history admits the features' source: a source has one domain.
      const want = table.kind === "state" ? cameras : cameras.filter((p) => p.cmd !== "UPDATE").map((p) => ({ ...p, with_check: p.with_check?.replace("s.domain = 'T'::text", "s.domain = 'road_context_features'::text") ?? null }));
      expect(await t.policies(table.name), table.name).toEqual(want);
    }
    for (const table of STATES) {
      expect((await t.columnsOf(`${table.name}_merged`)).map((x) => x.column_name), table.name).toEqual([...SYSTEM, ...Object.keys(table.cols), ...(table.generated ?? []), ...MERGE_COLUMNS]);
    }
    expect(await t.columnsOf("road_context_feature_versions_merged")).toEqual([]);
    const g = await t.grants([...TABLES.map((x) => x.name), ...STATES.map((x) => `${x.name}_merged`), "speed_cameras", "speed_cameras_merged"]);
    for (const table of STATES) {
      expect(g.get(table.name), table.name).toEqual(g.get("speed_cameras"));
      expect(g.get(`${table.name}_merged`), table.name).toEqual(g.get("speed_cameras_merged"));
    }
    expect(g.get("road_context_feature_versions")).toEqual(["viafrei_ingestor:INSERT,SELECT"]);
    const r = await t.readable([...TABLES.map((x) => `domains.${x.name}`), ...STATES.map((x) => `domains.${x.name}_merged`)]);
    expect(r.checked).toBe(5 * (TABLES.length + STATES.length));
    expect(r.open).toEqual([]);
  });

  it("keeps the version history unpartitioned and out of the retention job, as its old twin", async () => {
    const k = await t.pool.query<{ relkind: string }>("select relkind from pg_class where oid = 'domains.road_context_feature_versions'::regclass");
    expect(k.rows).toEqual([{ relkind: "r" }]);
    expect((await t.pool.query("select 1 from partition_retention where schema_name = 'domains' and table_name like 'road_context%'")).rowCount).toBe(0);
  });

  it("takes rows into each state table through the ingestor's upsert, generates the anchor, and an unchanged row moves nothing", async () => {
    await t.asSource(src("road_context_features"), async (c) => {
      const f = byName("road_context_features");
      expect((await upsert(c, f, [SIGNAL, DETOUR])).rows).toEqual([{ inserted: true }, { inserted: true }]);
      expect((await upsert(c, f, [SIGNAL, DETOUR])).rows).toEqual([]);
      const a = await c.query<{ external_id: string; anchor: string; props: unknown; answerable: boolean | null }>(
        "select external_id, ST_AsText(anchor, 6) as anchor, props, answerable from domains.road_context_features order by 1",
      );
      expect(a.rows).toEqual([
        { external_id: "det-1", anchor: "POINT(10.01 53.546667)", props: DETOUR["props"], answerable: null },
        { external_id: "sig-1", anchor: "POINT(10.0005 53.55)", props: SIGNAL["props"], answerable: null },
      ]);
    });
    await t.asSource(src("webcams"), async (c) => {
      expect((await upsert(c, byName("webcams"), [CAMERA])).rows).toEqual([{ inserted: true }]);
      expect((await upsert(c, byName("webcams"), [CAMERA])).rows).toEqual([]);
      const back = await c.query("select location_label, road_number, direction, link_url, ST_AsText(geom) as g from domains.webcams");
      expect(back.rows).toEqual([{ location_label: "Brücke am Hafen", road_number: "A7", direction: "Nord", link_url: "https://example.org/cam/1", g: "POINT(10 53.55)" }]);
    });
  });

  it("appends versions: a repeat is a no-op, a change is a new row, and a feature's history is read newest first", async () => {
    await t.asSource(src("road_context_features"), async (c) => {
      const v1: Row = { external_id: "det-1", observed_at: "2026-11-01T00:00:00Z", geom_wkt: "LINESTRING(10 53.54, 10.01 53.54)", content_hash: "h1", props: { valid_to: "2026-11-20" }, source_run_id: 1 };
      expect((await append(c, [v1])).rows).toEqual([{ inserted: true }]);
      expect((await append(c, [v1])).rows).toEqual([]);
      expect((await append(c, [{ ...v1, observed_at: "2026-11-10T00:00:00Z", content_hash: "h2", props: { valid_to: "2026-11-30" }, source_run_id: 2 }])).rows).toEqual([{ inserted: true }]);
      const h = await c.query<{ content_hash: string }>("select content_hash from domains.road_context_feature_versions where external_id = 'det-1' order by observed_at desc");
      expect(h.rows.map((x) => x.content_hash)).toEqual(["h2", "h1"]);
      await c.query("savepoint s");
      expect((await refusal(c.query("update domains.road_context_feature_versions set content_hash = 'x'")))?.code).toBe("42501");
      await c.query("rollback to savepoint s");
    });
  });

  it("one source writes a feature and its version in one transaction, and a source of another domain may append no version", async () => {
    await t.asSource(src("road_context_features"), async (c) => {
      expect((await upsert(c, byName("road_context_features"), [DETOUR])).rows).toEqual([{ inserted: true }]);
      expect((await append(c, [{ external_id: DETOUR.external_id, observed_at: "2026-11-01T00:00:00Z", geom_wkt: DETOUR.geom_wkt ?? null, content_hash: DETOUR["content_hash"], props: DETOUR["props"] }])).rows).toEqual([{ inserted: true }]);
      const both = await c.query<{ s: string; v: string }>(
        "select (select source_id from domains.road_context_features where external_id = 'det-1') as s, (select source_id from domains.road_context_feature_versions where external_id = 'det-1') as v",
      );
      expect(both.rows).toEqual([{ s: src("road_context_features"), v: src("road_context_features") }]);
    });
    await t.asSource("cameras-only", async (c) => {
      expect((await refusal(c.query(appendSql("domains.road_context_feature_versions", VERSIONS), [JSON.stringify([{ external_id: "x", content_hash: "h", props: {} }]), "cameras-only", "default"])))?.code).toBe("42501");
    });
  });

  it("answers the old near read over the new table, kind by kind, through the gist index", async () => {
    await t.planted(async (c) => {
      await c.query("select set_config('viafrei.source_id', $1, true)", [src("road_context_features")]);
      await upsert(c, byName("road_context_features"), [SIGNAL, DETOUR, { ...SIGNAL, external_id: "sig-far", geom_wkt: "POINT(11 53.55)" }]);
      await c.query(
        `insert into domains.road_context_features (source_id, external_id, geom, kind, variant, name, content_hash)
         select 'road-context-features-a', 'bulk-' || g, ST_SetSRID(ST_MakePoint(6 + (g % 100) * 0.08, 47.5 + (g / 100) * 0.07), 4326), 'traffic_signal', 'plain', 'S' || g, 'h'
           from generate_series(1, 8000) g`,
      );
      await c.query("analyze domains.road_context_features");
      const near = `select w.external_id, w.variant, round(ST_Distance(w.geom::geography, ST_SetSRID(ST_MakePoint(10, 53.55), 4326)::geography)) as m
                      from domains.road_context_features w
                     where w.closed_at is null and coalesce(w.answerable, true) and w.kind = $1
                       and w.geom && st_expand(ST_SetSRID(ST_MakePoint(10, 53.55), 4326), 0.02)
                       and ST_DWithin(w.geom::geography, ST_SetSRID(ST_MakePoint(10, 53.55), 4326)::geography, $2)
                     order by m, w.external_id`;
      expect((await c.query(near, ["traffic_signal", 300])).rows).toEqual([{ external_id: "sig-1", variant: "acoustic", m: 33 }]);
      expect((await c.query(near, ["detour", 1500])).rows.map((x: { external_id: string }) => x.external_id)).toEqual(["det-1"]);
      await c.query("set local enable_seqscan = off");
      const plan = (await c.query<{ "QUERY PLAN": string }>(`explain ${near.replace("$1", "'traffic_signal'").replace("$2", "300")}`)).rows.map((x) => x["QUERY PLAN"]).join("\n");
      expect(plan).toMatch(/road_context_features_geom/);
      expect(plan).not.toMatch(/Seq Scan/);
    });
  });

  it("refuses what the old tables refused", async () => {
    const cases: [string, Row, string, string][] = [
      ["road_context_features", { ...SIGNAL, kind: "speed_bump" }, "23514", "road_context_features_kind"],
      ["road_context_features", { ...SIGNAL, variant: "signed" }, "23514", "road_context_features_variant"],
      ["road_context_features", { ...DETOUR, kind: "motorway_detour", variant: "motor_vehicles" }, "23514", "road_context_features_variant"],
      ["road_context_features", { ...SIGNAL, name: null }, "23502", "name"],
      ["road_context_features", { ...SIGNAL, content_hash: "" }, "23514", "road_context_features_content_hash"],
      ["road_context_features", { ...SIGNAL, props: ["x"] }, "23514", "road_context_features_props_object"],
      ["webcams", { ...CAMERA, location_label: "" }, "23514", "webcams_location_label"],
      ["webcams", { ...CAMERA, location_label: null }, "23502", "location_label"],
      ["webcams", { ...CAMERA, link_url: "http://example.org/cam/1" }, "23514", "webcams_link_url"],
      ["webcams", { ...CAMERA, geom_wkt: "LINESTRING(10 53, 10.1 53.1)" }, "23514", "webcams_geom_point"],
    ];
    for (const [name, row, code, word] of cases) {
      await t.asSource(src(name), async (c) => {
        const e = await refusal(upsert(c, byName(name), [row]));
        expect(e?.code, word).toBe(code);
        expect(e?.message, word).toContain(word);
      });
    }
    for (const [row, code, word] of [
      [{ external_id: "x", content_hash: "", props: {} }, "23514", "road_context_feature_versions_content_hash"],
      [{ external_id: "x", content_hash: "h", props: [] }, "23514", "road_context_feature_versions_props_object"],
    ] as const) {
      await t.asSource(src("road_context_features"), async (c) => {
        const e = await refusal(append(c, [row]));
        expect(e?.code, word).toBe(code);
        expect(e?.message, word).toContain(word);
      });
    }
    await t.asSource("cameras-only", async (c) => {
      expect((await refusal(upsert(c, byName("webcams"), [CAMERA])))?.code).toBe("42501");
    });
  });

  it("leaves the old tables and their live views as the baseline made them", async () => {
    for (const table of ["road_context_features", "road_context_feature_versions", "hh_cameras"]) {
      const a = await t.baselineAgreement(table);
      expect(a.baseline.columns.length, table).toBeGreaterThan(5);
      expect(a.catalogue, table).toEqual(a.baseline);
    }
    const g = await t.pool.query<{ ok: boolean }>(
      "select has_table_privilege('viafrei_digest', 'public.road_context_live', 'select') and has_table_privilege('viafrei_digest', 'public.hh_cameras_live', 'select') as ok",
    );
    expect(g.rows).toEqual([{ ok: true }]);
  });
});
