/**
 * domains.charging_points against a real catalogue: the domain shape (the
 * system columns, the owner key, the indexes, row-level security, the merged
 * view and the grants), the column types a domain writer can declare, and the
 * writes the ingestor role makes, through the same insert-or-update shape it
 * sends (one jsonb parameter per batch, jsonb_to_recordset).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * It makes a database of its own next to TEST_DATABASE_URL's (migrate.db.test.ts
 * needs that one EMPTY), migrates it to head through the service, and drops it
 * afterwards. Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { DatabaseService } from "../src/service.js";

const url = process.env["TEST_DATABASE_URL"];
const required = process.env["VF_REQUIRE_DB"] === "1";

if (url === undefined && required) {
  describe("domains.charging_points", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the charging_points test did not run");
    });
  });
}

const T = "domains.charging_points";
const SYSTEM = ["id", "source_id", "feed", "external_id", "match_key", "observed_at", "first_seen_at", "updated_at", "closed_at", "geom", "extras"];
/** The columns a writer sends, with the type it declares for each (the ingestor's SQL_TYPE vocabulary), in table order. */
const WRITABLE: Readonly<Record<string, string>> = {
  device_id: "text",
  point_no: "integer",
  site_key: "text",
  operator: "text",
  site_name: "text",
  street: "text",
  house_number: "text",
  postcode: "text",
  city: "text",
  status: "text",
  device_kind: "text",
  connector_types: "jsonb",
  plugs: "jsonb",
  current_type: "text",
  max_power_kw: "double precision",
  evse_id: "text",
  evse_id_published: "text",
  commissioned_on: "date",
  published_on: "date",
};
const REQUIRED = new Set(["device_id", "point_no", "site_key"]);
const WRITER_TYPES = new Set(["text", "integer", "bigint", "double precision", "numeric", "boolean", "timestamp with time zone", "date", "jsonb"]);

type Point = { external_id: string; match_key?: string | null; geom_wkt?: string | null; extras?: unknown } & Partial<Record<keyof typeof WRITABLE, unknown>>;

/** The ingestor's upsert for this domain (core/write-sql.ts upsertStatement, the same text for these columns). */
function upsertSql(): string {
  const cols = Object.keys(WRITABLE);
  const recordset = ["external_id text", "match_key text", "observed_at timestamptz", "geom_wkt text", "extras jsonb", ...cols.map((c) => `${c} ${WRITABLE[c] ?? ""}`)].join(", ");
  const change = ["match_key", "observed_at", "geom", "extras", ...cols];
  const compared = change.filter((c) => c !== "observed_at");
  return `insert into ${T} as t (source_id, feed, external_id, match_key, observed_at, geom, extras, ${cols.join(", ")})
select $2, $3, r.external_id, r.match_key, coalesce(r.observed_at, clock_timestamp()),
       case when r.geom_wkt is not null then ST_GeomFromText(r.geom_wkt, 4326) end,
       coalesce(r.extras, '{}'::jsonb), ${cols.map((c) => `r.${c}`).join(", ")}
  from jsonb_to_recordset($1::jsonb) as r(${recordset})
on conflict (source_id, feed, external_id) do update
   set ${change.map((c) => `${c} = excluded.${c}`).join(", ")}, closed_at = null, updated_at = clock_timestamp()
 where (${compared.map((c) => `t.${c}`).join(", ")}, t.closed_at) is distinct from (${compared.map((c) => `excluded.${c}`).join(", ")}, null)
returning (xmax = 0) as inserted`;
}

describe.skipIf(url === undefined)("domains.charging_points", () => {
  const name = `test_vfdb_charging_${String(process.pid)}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  const own = new URL(url ?? "postgresql://x@127.0.0.1/x");
  own.pathname = `/${name}`;
  const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
  let svc: DatabaseService | undefined;
  let pool: pg.Pool | undefined;
  const db = (): pg.Pool => {
    if (pool === undefined) throw new Error("the test database was not made");
    return pool;
  };

  beforeAll(async () => {
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
    svc = new DatabaseService({ config: loadConfig({ DATABASE_URL: own.toString(), DB_MIGRATE_LOCK_PAUSE_S: "1" }, "serve"), log });
    await svc.boot(1_000);
    pool = new pg.Pool({ connectionString: own.toString(), max: 2 });
    for (const [id, domain, trust] of [
      ["charging-high", "charging_points", 80],
      ["charging-low", "charging_points", 20],
      ["cameras-only", "speed_cameras", 50],
    ] as const) {
      await pool.query(
        `insert into ingestor.sources (id, name, domain, provider, config_sha256, status, publisher, country, added_in, licence_id, attribution, trust, schedule, registered_by)
         values ($1, $1, $2, 'test', repeat('0', 64), 'enabled', 'Test', 'DE', '0.0.1', 'CC-BY-4.0', 'Test', $3, '{}'::jsonb, 'test')`,
        [id, domain, trust],
      );
    }
  }, 900_000);

  afterAll(async () => {
    await pool?.end();
    await svc?.close();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  });

  /** Runs fn as viafrei_ingestor for one source, in a transaction that is rolled back. */
  async function asSource<R>(source: string | null, fn: (c: pg.PoolClient) => Promise<R>): Promise<R> {
    const c = await db().connect();
    try {
      await c.query("begin");
      await c.query("set local role viafrei_ingestor");
      if (source !== null) await c.query("select set_config('viafrei.source_id', $1, true)", [source]);
      return await fn(c);
    } finally {
      await c.query("rollback");
      c.release();
    }
  }
  const write = (c: pg.PoolClient, source: string, rows: Point[]): Promise<pg.QueryResult<{ inserted: boolean }>> =>
    c.query<{ inserted: boolean }>(upsertSql(), [JSON.stringify(rows), source, "default"]);
  const refusal = (p: Promise<unknown>): Promise<{ code?: string; message: string } | null> =>
    p.then(
      () => null,
      (e: unknown) => e as { code?: string; message: string },
    );

  const POINT: Point = {
    external_id: "DEV-1:1",
    geom_wkt: "POINT(13.404954 52.520008)",
    extras: { device: { openingHours: "247" } },
    device_id: "DEV-1",
    point_no: 1,
    site_key: "52.520008,13.404954:0123456789ab",
    operator: "Stadtwerke Musterstadt GmbH",
    site_name: "Am Markt",
    street: "Hauptstraße",
    house_number: "12a",
    postcode: "10115",
    city: "Berlin",
    status: "In Betrieb",
    device_kind: "Schnellladeeinrichtung",
    connector_types: ["iec62196T2", "iec62196T2COMBO"],
    plugs: ["AC Typ 2 Steckdose", "DC Kupplung Combo, CCS"],
    current_type: "both",
    max_power_kw: 150.5,
    evse_id: "DE*ABC*E1*1",
    evse_id_published: null,
    commissioned_on: "2024-03-01",
    published_on: "2026-11-12",
  };

  type Col = { column_name: string; data_type: string; is_nullable: string; column_default: string | null; is_identity: string };
  const columnsOf = async (table: string): Promise<Col[]> =>
    (
      await db().query<Col>(
        `select column_name, case when data_type = 'USER-DEFINED' then udt_name else data_type end as data_type, is_nullable, column_default, is_identity
           from information_schema.columns where table_schema = 'domains' and table_name = $1 order by ordinal_position`,
        [table],
      )
    ).rows;

  it("is at head with the migration applied", async () => {
    const r = await db().query<{ version: number }>("select max(version)::int as version from schema_migrations");
    expect(r.rows[0]?.version).toBe(svc?.files.at(-1)?.version);
    const own = await db().query("select 1 from schema_migrations where version = 294 and name = '0294_domain_charging_points.sql'");
    expect(own.rowCount).toBe(1);
  });

  it("has the system columns of speed_cameras, then the domain columns, each in a type a writer declares", async () => {
    const mine = await columnsOf("charging_points");
    expect(mine.map((x) => x.column_name)).toEqual([...SYSTEM, ...Object.keys(WRITABLE)]);
    expect(mine.slice(0, SYSTEM.length)).toEqual((await columnsOf("speed_cameras")).slice(0, SYSTEM.length));
    for (const x of mine.slice(SYSTEM.length)) {
      expect(x.data_type, x.column_name).toBe(WRITABLE[x.column_name]);
      expect(WRITER_TYPES.has(x.data_type), x.column_name).toBe(true);
      expect(x.is_nullable, x.column_name).toBe(REQUIRED.has(x.column_name) ? "NO" : "YES");
      expect(x.column_default, x.column_name).toBeNull();
    }
    const geom = await db().query<{ t: string }>(`select format_type(atttypid, atttypmod) as t from pg_attribute where attrelid = '${T}'::regclass and attname = 'geom'`);
    expect(geom.rows[0]?.t).toBe("geometry(Geometry,4326)");
  });

  it("has the constraints and indexes of speed_cameras, under its own names", async () => {
    const shape = async (table: string): Promise<string[]> => {
      const idx = await db().query<{ d: string }>("select indexdef as d from pg_indexes where schemaname = 'domains' and tablename = $1", [table]);
      const con = await db().query<{ d: string }>("select contype::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) as d from pg_constraint where conrelid = ('domains.' || $1)::regclass", [table]);
      return [...idx.rows, ...con.rows].map((x) => x.d.replaceAll(table, "T")).sort();
    };
    const mine = await shape("charging_points");
    expect(mine).toEqual(await shape("speed_cameras"));
    expect(mine.filter((d) => d.startsWith("CREATE"))).toEqual([
      "CREATE INDEX T_geom ON domains.T USING gist (geom)",
      "CREATE INDEX T_match ON domains.T USING btree (match_key) WHERE (closed_at IS NULL)",
      "CREATE INDEX T_owner_open ON domains.T USING btree (source_id, feed) WHERE (closed_at IS NULL)",
      "CREATE UNIQUE INDEX T_owner_key ON domains.T USING btree (source_id, feed, external_id)",
      "CREATE UNIQUE INDEX T_pkey ON domains.T USING btree (id)",
    ]);
  });

  it("enables and forces row-level security with the policies of speed_cameras", async () => {
    const rls = await db().query<{ e: boolean; f: boolean }>(`select relrowsecurity as e, relforcerowsecurity as f from pg_class where oid = '${T}'::regclass`);
    expect(rls.rows[0]).toEqual({ e: true, f: true });
    type Pol = { policyname: string; cmd: string; roles: string[]; qual: string | null; with_check: string | null };
    const policies = async (table: string): Promise<Pol[]> =>
      (
        await db().query<Pol>("select policyname, cmd, roles::text[] as roles, qual, with_check from pg_policies where schemaname = 'domains' and tablename = $1 order by policyname", [table])
      ).rows.map((x) => ({ ...x, policyname: x.policyname.replace(table, "T"), with_check: x.with_check?.replaceAll(table, "T") ?? null }));
    const mine = await policies("charging_points");
    expect(mine.map((x) => x.cmd)).toEqual(["INSERT", "UPDATE", "SELECT"]);
    expect(mine.map((x) => x.roles)).toEqual([["viafrei_ingestor"], ["viafrei_ingestor"], ["public"]]);
    expect(mine).toEqual(await policies("speed_cameras"));
  });

  it("has a merged view of every table column plus the merge columns", async () => {
    const r = await columnsOf("charging_points_merged");
    expect(r.map((x) => x.column_name)).toEqual([...SYSTEM, ...Object.keys(WRITABLE), "entity_key", "trust", "attribution", "licence_id", "sources", "source_count"]);
  });

  it("grants the ingestor what speed_cameras grants it, and nobody else anything", async () => {
    const r = await db().query<{ rel: string; grantee: string; privs: string }>(
      `select c.relname as rel, g.rolname as grantee, string_agg(x.privilege_type, ',' order by x.privilege_type) as privs
         from pg_class c cross join lateral aclexplode(c.relacl) x join pg_roles g on g.oid = x.grantee
        where c.relnamespace = 'domains'::regnamespace and c.relname in ('charging_points', 'charging_points_merged', 'speed_cameras', 'speed_cameras_merged')
          and x.grantee <> c.relowner
        group by 1, 2 order by 1, 2`,
    );
    const of = (rel: string): string[] => r.rows.filter((x) => x.rel === rel).map((x) => `${x.grantee}:${x.privs}`);
    expect(of("charging_points")).toEqual(["viafrei_ingestor:INSERT,SELECT,UPDATE"]);
    expect(of("charging_points_merged")).toEqual(["viafrei_ingestor:SELECT"]);
    expect(of("charging_points")).toEqual(of("speed_cameras"));
    expect(of("charging_points_merged")).toEqual(of("speed_cameras_merged"));
  });

  it("takes a register point through the ingestor's upsert, and an unchanged one moves no row", async () => {
    await asSource("charging-high", async (c) => {
      expect((await write(c, "charging-high", [POINT])).rows).toEqual([{ inserted: true }]);
      expect((await write(c, "charging-high", [POINT])).rows).toEqual([]);
      const r = await c.query<Record<string, unknown>>(
        `select external_id, device_id, point_no, site_key, max_power_kw, connector_types, plugs, commissioned_on::text as commissioned,
                published_on::text as published, ST_AsText(geom) as wkt, extras
           from ${T} where source_id = 'charging-high'`,
      );
      expect(r.rows).toEqual([
        {
          external_id: "DEV-1:1",
          device_id: "DEV-1",
          point_no: 1,
          site_key: "52.520008,13.404954:0123456789ab",
          max_power_kw: 150.5,
          connector_types: ["iec62196T2", "iec62196T2COMBO"],
          plugs: ["AC Typ 2 Steckdose", "DC Kupplung Combo, CCS"],
          commissioned: "2024-03-01",
          published: "2026-11-12",
          wkt: "POINT(13.404954 52.520008)",
          extras: { device: { openingHours: "247" } },
        },
      ]);
    });
  });

  it("refuses a point without its device, its number or its site, and an empty key", async () => {
    await asSource("charging-high", async (c) => {
      const cases: [Point, string, string][] = [
        [{ ...POINT, device_id: null }, "23502", "device_id"],
        [{ ...POINT, point_no: null }, "23502", "point_no"],
        [{ ...POINT, site_key: null }, "23502", "site_key"],
        [{ ...POINT, external_id: "" }, "23514", "charging_points_external_id_check"],
      ];
      for (const [row, code, word] of cases) {
        await c.query("savepoint s");
        const e = await refusal(write(c, "charging-high", [row]));
        await c.query("rollback to savepoint s");
        expect(e?.code, word).toBe(code);
        expect(e?.message, word).toContain(word);
      }
    });
  });

  it("refuses a write for another source, for a source of another domain, and without a source set", async () => {
    await asSource("charging-high", async (c) => {
      expect((await refusal(write(c, "charging-low", [POINT])))?.code).toBe("42501");
    });
    await asSource("cameras-only", async (c) => {
      expect((await refusal(write(c, "cameras-only", [POINT])))?.code).toBe("42501");
    });
    await asSource(null, async (c) => {
      expect((await refusal(write(c, "charging-high", [POINT])))?.code).toBe("42501");
    });
  });

  it("lets a source update and close only its own rows", async () => {
    await asSource("charging-high", async (c) => {
      await write(c, "charging-high", [POINT]);
      await c.query("select set_config('viafrei.source_id', 'charging-low', true)");
      await write(c, "charging-low", [{ ...POINT, max_power_kw: 22 }]);
      // A close that names no owner still reaches only the writer's own rows.
      const closed = await c.query(`update ${T} set closed_at = clock_timestamp() where feed = 'default' and closed_at is null and not (external_id = any($1::text[]))`, [["none"]]);
      expect(closed.rowCount).toBe(1);
      const r = await c.query<{ source_id: string; open: boolean }>(`select source_id, closed_at is null as open from ${T} order by source_id`);
      expect(r.rows).toEqual([
        { source_id: "charging-high", open: true },
        { source_id: "charging-low", open: false },
      ]);
    });
  });

  it("merges one entity per match key, the most trusted source first, every source attributed", async () => {
    await asSource("charging-high", async (c) => {
      await write(c, "charging-high", [{ ...POINT, match_key: "DEABCE11" }]);
      await c.query("select set_config('viafrei.source_id', 'charging-low', true)");
      await write(c, "charging-low", [{ ...POINT, external_id: "X:1", device_id: "X", match_key: "DEABCE11", max_power_kw: 22 }]);
      const r = await c.query<{ source_id: string; kw: number; source_count: number; n: number; ids: string[] }>(
        `select source_id, max_power_kw as kw, source_count, (select count(*)::int from domains.charging_points_merged) as n,
                (select array_agg(x->>'source_id' order by x->>'source_id') from jsonb_array_elements(sources) x) as ids
           from domains.charging_points_merged where entity_key = 'DEABCE11'`,
      );
      expect(r.rows).toEqual([{ source_id: "charging-high", kw: 150.5, source_count: 2, n: 1, ids: ["charging-high", "charging-low"] }]);
    });
  });

  it("leaves the old tables as they were", async () => {
    const r = await db().query<{ t: string | null }>("select to_regclass('public.charging_points')::text as t union all select to_regclass('public.charging_sites')::text");
    expect(r.rows.map((x) => x.t)).toEqual(["charging_points", "charging_sites"]);
    const k = await db().query<{ n: number }>("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'charging_points' and column_name = 'point_key'");
    expect(k.rows[0]?.n).toBe(1);
  });
});
