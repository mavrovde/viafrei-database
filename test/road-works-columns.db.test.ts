/**
 * domains.road_works with the columns its readers use on the old
 * public.opendata_roadworks: the added columns, the generated anchor, the
 * merged view rebuilt over the new shape, the anchor index the place card's
 * read needs, and the old tables left as the baseline made them.
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
  describe("domains.road_works reader columns", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the road works test did not run");
    });
  });
}

const W = "domains.road_works";
const BASE = ["title", "description", "street", "municipality", "starts_at", "ends_at", "restriction"];
const ADDED: Readonly<Record<string, string>> = {
  kind: "text",
  place_text: "text",
  organisation: "text",
  closure: "boolean",
  affects_traffic: "boolean",
  answerable: "boolean",
  day_precision: "boolean",
  period_text: "text",
  link: "text",
  closure_starts_at: "timestamp with time zone",
  closure_ends_at: "timestamp with time zone",
  last_seen_at: "timestamp with time zone",
};
const WRITABLE: Readonly<Record<string, string>> = {
  title: "text",
  description: "text",
  starts_at: "timestamptz",
  ends_at: "timestamptz",
  ...ADDED,
};

type Row = { external_id: string; geom_wkt?: string | null } & Record<string, unknown>;

describe.skipIf(url === undefined)("domains.road_works reader columns", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "road_wk");

  beforeAll(async () => {
    await t.make([
      ["works-a", "road_works", 50],
      ["works-b", "road_works", 30],
    ]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  const upsert = (c: pg.PoolClient, source: string, rows: Row[]): Promise<pg.QueryResult<{ inserted: boolean }>> => c.query<{ inserted: boolean }>(upsertSql(W, WRITABLE), [JSON.stringify(rows), source, "default"]);

  const WORK: Row = {
    external_id: "S-1",
    geom_wkt: "LINESTRING(13.0 52.0, 13.0 52.02)",
    title: "Fahrbahnsanierung",
    description: "Halbseitige Sperrung",
    starts_at: "2026-11-10T23:00:00Z",
    ends_at: "2026-11-20T23:00:00Z",
    kind: "roadworks",
    place_text: "Hauptstraße zwischen Markt und Bahnhof",
    organisation: "Ein Tiefbauamt",
    closure: true,
    affects_traffic: true,
    answerable: true,
    day_precision: true,
    period_text: "11.11. bis 20.11.",
    link: "https://example.org/baustelle/1",
    closure_starts_at: "2026-11-15T20:00:00Z",
    closure_ends_at: "2026-11-16T05:00:00Z",
    last_seen_at: "2026-11-14T08:00:00Z",
  };

  it("is applied", async () => {
    expect((await t.pool.query("select 1 from schema_migrations where version = 298 and name = '0298_domain_road_works_reader_columns.sql'")).rowCount).toBe(1);
  });

  it("keeps the system columns and the baseline's domain columns, then the added ones, and a generated anchor last", async () => {
    const cols = await t.columnsOf("road_works");
    expect(cols.map((x) => x.column_name)).toEqual([...SYSTEM, ...BASE, ...Object.keys(ADDED), "anchor"]);
    expect(cols.slice(0, SYSTEM.length)).toEqual((await t.columnsOf("speed_cameras")).slice(0, SYSTEM.length));
    for (const x of cols.filter((c) => c.column_name in ADDED)) {
      expect(x.data_type, x.column_name).toBe(ADDED[x.column_name]);
      expect(WRITER_TYPES.has(x.data_type), x.column_name).toBe(true);
      expect(x.is_nullable, x.column_name).toBe("YES");
      expect(x.column_default, x.column_name).toBeNull();
    }
    const g = await t.pool.query<{ is_generated: string; expr: string; typ: string }>(
      `select c.is_generated, c.generation_expression as expr, format_type(a.atttypid, a.atttypmod) as typ
         from information_schema.columns c join pg_attribute a on a.attrelid = '${W}'::regclass and a.attname = c.column_name
        where c.table_schema = 'domains' and c.table_name = 'road_works' and c.column_name = 'anchor'`,
    );
    expect(g.rows).toEqual([{ is_generated: "ALWAYS", expr: "st_closestpoint(geom, st_centroid(geom))", typ: "geometry(Point,4326)" }]);
  });

  it("has its own checks and the anchor index, the rest as speed_cameras", async () => {
    const own = /T_(kind|period_ordered|closure_window_ordered|anchor|title_nonempty) /;
    const shape = await t.shape("road_works");
    expect(shape.filter((d) => own.test(d))).toEqual([
      "CREATE INDEX T_anchor ON domains.T USING gist (anchor) WHERE (closed_at IS NULL)",
      "c T_closure_window_ordered CHECK (((closure_starts_at IS NULL) OR (closure_ends_at IS NULL) OR (closure_starts_at < closure_ends_at)))",
      "c T_kind CHECK (((kind IS NULL) OR (kind = ANY (ARRAY['roadworks'::text, 'event'::text, 'message'::text]))))",
      "c T_period_ordered CHECK (((starts_at IS NULL) OR (ends_at IS NULL) OR (starts_at <= ends_at)))",
      "c T_title_nonempty CHECK ((title <> ''::text))",
    ]);
    expect(shape.filter((d) => !own.test(d))).toEqual(await t.convention());
    expect(await t.policies("road_works")).toEqual(await t.policies("speed_cameras"));
  });

  it("rebuilds the merged view over the new shape, the same statement as speed_cameras', with its grant and no reader", async () => {
    expect((await t.columnsOf("road_works_merged")).map((x) => x.column_name)).toEqual([...SYSTEM, ...BASE, ...Object.keys(ADDED), "anchor", ...MERGE_COLUMNS]);
    const def = async (v: string): Promise<string> => (await t.pool.query<{ d: string }>(`select pg_get_viewdef('domains.${v}'::regclass) as d`)).rows[0]?.d ?? "";
    // The column lists differ by table; everything else must be the same statement.
    const strip = (d: string, table: string): string =>
      d
        .replaceAll(table, "T")
        .split("\n")
        .filter((l) => !/^\s+(r\.\w+|\(w\)\.\w+ AS \w+),$/.test(l))
        .join("\n");
    const mine = strip(await def("road_works_merged"), "road_works");
    const model = strip(await def("speed_cameras_merged"), "speed_cameras");
    expect(mine).toMatch(/row_number\(\) OVER/);
    expect(mine).toBe(model);
    const g = await t.grants(["road_works", "road_works_merged", "speed_cameras", "speed_cameras_merged"]);
    expect(g.get("road_works")).toEqual(g.get("speed_cameras"));
    expect(g.get("road_works_merged")).toEqual(g.get("speed_cameras_merged"));
    expect((await t.readable([W, `${W}_merged`])).open).toEqual([]);
  });

  it("takes a work through the ingestor's upsert, generates the anchor on the shape, and moves it with geom", async () => {
    await t.asSource("works-a", async (c) => {
      expect((await upsert(c, "works-a", [WORK])).rows).toEqual([{ inserted: true }]);
      expect((await upsert(c, "works-a", [WORK])).rows).toEqual([]);
      const read = async (): Promise<Record<string, unknown> | undefined> =>
        (await c.query<Record<string, unknown>>(`select kind, closure, day_precision, link, ST_AsText(ST_SnapToGrid(anchor, 0.000001)) as anchor, ST_Intersects(anchor, geom) as on_shape from ${W}`)).rows[0];
      expect(await read()).toEqual({ kind: "roadworks", closure: true, day_precision: true, link: "https://example.org/baustelle/1", anchor: "POINT(13 52.01)", on_shape: true });
      await upsert(c, "works-a", [{ ...WORK, geom_wkt: "POINT(9.5 51.3)" }]);
      expect((await read())?.["anchor"]).toBe("POINT(9.5 51.3)");
      await c.query("savepoint s");
      expect((await refusal(c.query(`update ${W} set anchor = ST_SetSRID(ST_MakePoint(0, 0), 4326)`)))?.code).toBe("428C9");
      await c.query("rollback to savepoint s");
      await upsert(c, "works-a", [{ ...WORK, geom_wkt: null }]);
      expect((await read())?.["anchor"]).toBeNull();
    });
  });

  it("refuses an unknown kind and a period or a closure window that ends before it starts", async () => {
    await t.asSource("works-a", async (c) => {
      for (const [row, word] of [
        [{ ...WORK, kind: "baustelle" }, "road_works_kind"],
        [{ ...WORK, ends_at: "2026-11-01T00:00:00Z" }, "road_works_period_ordered"],
        [{ ...WORK, closure_ends_at: "2026-11-15T20:00:00Z" }, "road_works_closure_window_ordered"],
      ] as const) {
        await c.query("savepoint s");
        const e = await refusal(upsert(c, "works-a", [row]));
        await c.query("rollback to savepoint s");
        expect(e?.code, word).toBe("23514");
        expect(e?.message, word).toContain(word);
      }
    });
  });

  it("finds the open works near a point through the anchor index, nearest first", async () => {
    await t.planted(async (c) => {
      await c.query(
        `insert into ${W} (source_id, external_id, title, geom, closed_at)
         select 'works-a', 'W' || g, 'T', ST_SetSRID(ST_MakePoint(6 + (g % 90) * 0.1, 47 + (g / 90) * 0.1), 4326), case when g % 4 = 0 then now() end
           from generate_series(1, 6000) g`,
      );
      await c.query(`analyze ${W}`);
      await c.query("set local enable_seqscan = off");
      const plan = (await c.query<{ "QUERY PLAN": string }>(
        `explain select external_id from ${W} where closed_at is null and anchor && ST_Expand(ST_SetSRID(ST_MakePoint(10, 50), 4326), 0.1)
          order by anchor <-> ST_SetSRID(ST_MakePoint(10, 50), 4326) limit 16`,
      )).rows.map((x) => x["QUERY PLAN"]).join("\n");
      expect(plan).toMatch(/road_works_anchor/);
    });
  });

  it("leaves the old tables as the baseline made them", async () => {
    for (const table of ["opendata_roadworks", "opendata_roadwork_versions", "speed_enforcement"]) {
      const a = await t.baselineAgreement(table);
      expect(a.baseline.columns.length, table).toBeGreaterThan(5);
      expect(a.catalogue, table).toEqual(a.baseline);
    }
  });
});
