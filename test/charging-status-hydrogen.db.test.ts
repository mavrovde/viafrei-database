/**
 * domains.charging_point_status (a tick table) and domains.hydrogen_stations
 * (a state table) against a real catalogue: the domain shape compared with
 * domains.speed_cameras, the daily partitions of a tick table outside the
 * current schema, the writes the ingestor role makes, the merge, and the old
 * tables left as the baseline made them.
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
  describe("domains.charging_point_status and domains.hydrogen_stations", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the charging status test did not run");
    });
  });
}

const S = "domains.charging_point_status";
const H = "domains.hydrogen_stations";
const STATUS: Readonly<Record<string, string>> = {
  evse_id: "text",
  site_key: "text",
  station_id: "text",
  status: "text",
  operation_status: "text",
  opening_status: "text",
  exchange_protocol: "text",
  feed_ts: "timestamp with time zone",
  last_updated: "timestamp with time zone",
  confidentiality: "text",
  source_run_id: "bigint",
};
const HYDROGEN: Readonly<Record<string, string>> = {
  name: "text",
  operator: "text",
  brand: "text",
  address: "jsonb",
  refill: "jsonb",
  opening: "jsonb",
  source_publisher: "text",
  provider_updated_at: "timestamp with time zone",
  last_seen_at: "timestamp with time zone",
};

type Row = { external_id: string; match_key?: string | null; observed_at?: string | null; geom_wkt?: string | null; extras?: unknown } & Record<string, unknown>;

describe.skipIf(url === undefined)("domains.charging_point_status and domains.hydrogen_stations", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "status_h2");

  beforeAll(async () => {
    await t.make([
      ["status-a", "charging_point_status", 50],
      ["status-b", "charging_point_status", 50],
      ["h2-high", "hydrogen_stations", 80],
      ["h2-low", "hydrogen_stations", 20],
      ["h2-peer", "hydrogen_stations", 80],
      ["cameras-only", "speed_cameras", 50],
    ]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  const append = (c: pg.PoolClient, source: string, rows: Row[]): Promise<pg.QueryResult<{ inserted: boolean }>> => c.query<{ inserted: boolean }>(appendSql(S, STATUS), [JSON.stringify(rows), source, "default"]);
  const upsert = (c: pg.PoolClient, source: string, rows: Row[]): Promise<pg.QueryResult<{ inserted: boolean }>> => c.query<{ inserted: boolean }>(upsertSql(H, HYDROGEN), [JSON.stringify(rows), source, "default"]);

  const now = new Date();
  const at = (minutes: number): string => new Date(now.getTime() + minutes * 60_000).toISOString();
  const TICK: Row = {
    external_id: "DE*ABC*E1*1",
    observed_at: at(0),
    evse_id: "DE*ABC*E1*1",
    site_key: "SITE-1",
    station_id: "ST-1",
    status: "AVAILABLE",
    operation_status: "OPERATIONAL",
    opening_status: "OPEN",
    exchange_protocol: "deltaPull",
    feed_ts: at(-1),
    last_updated: at(-2),
    confidentiality: "noRestriction",
    source_run_id: 7,
  };
  const STATION: Row = {
    external_id: "H2-1",
    geom_wkt: "POINT(9.993682 53.551086)",
    name: "H2 Musterstadt",
    operator: "Wasserstoff GmbH",
    brand: "H2",
    address: { street: "Hafenstraße 1", postcode: "20095", city: "Hamburg" },
    refill: [{ pressure: "700 bar", vehicle: "car", state: "open" }],
    opening: { always: true },
    source_publisher: "Ein Verbund",
    provider_updated_at: "2026-11-10T08:00:00Z",
    last_seen_at: "2026-11-14T08:00:00Z",
  };

  it("is at head with the migration applied", async () => {
    const r = await t.pool.query<{ version: number }>("select max(version)::int as version from schema_migrations");
    expect(r.rows[0]?.version).toBe(t.files.at(-1)?.version);
    expect((await t.pool.query("select 1 from schema_migrations where version = 296 and name = '0296_domain_charging_point_status_hydrogen_stations.sql'")).rowCount).toBe(1);
  });

  it("has the system columns of speed_cameras, then the domain columns, each in a type a writer declares", async () => {
    const cameras = (await t.columnsOf("speed_cameras")).slice(0, SYSTEM.length);
    for (const [table, writable, required] of [
      ["charging_point_status", STATUS, new Set<string>()],
      ["hydrogen_stations", HYDROGEN, new Set(["refill"])],
    ] as const) {
      const mine = await t.columnsOf(table);
      expect(mine.map((x) => x.column_name), table).toEqual([...SYSTEM, ...Object.keys(writable)]);
      expect(mine.slice(0, SYSTEM.length), table).toEqual(cameras);
      for (const x of mine.slice(SYSTEM.length)) {
        expect(x.data_type, x.column_name).toBe(writable[x.column_name]);
        expect(WRITER_TYPES.has(x.data_type), x.column_name).toBe(true);
        expect(x.is_nullable, x.column_name).toBe(required.has(x.column_name) ? "NO" : "YES");
        expect(x.column_default, x.column_name).toBeNull();
      }
    }
  });

  it("makes charging_point_status a tick table: partitioned by day on observed_at, no default partition, today and tomorrow covered", async () => {
    const key = await t.pool.query<{ k: string }>(`select pg_get_partkeydef('${S}'::regclass) as k`);
    expect(key.rows[0]?.k).toBe("RANGE (observed_at)");
    const kids = await t.pool.query<{ name: string; bound: string }>(
      `select k.relname as name, pg_get_expr(k.relpartbound, k.oid) as bound
         from pg_inherits i join pg_class k on k.oid = i.inhrelid where i.inhparent = '${S}'::regclass order by 1`,
    );
    expect(kids.rows.filter((x) => x.bound === "DEFAULT")).toEqual([]);
    // boot ensures 3 days back and the serve days ahead (30): 34 partitions.
    expect(kids.rows.length).toBe(34);
    expect(kids.rows.every((x) => /^charging_point_status_\d{8}$/.test(x.name))).toBe(true);
    const ns = await t.pool.query<{ n: string }>(`select distinct n.nspname as n from pg_inherits i join pg_class k on k.oid = i.inhrelid join pg_namespace n on n.oid = k.relnamespace where i.inhparent = '${S}'::regclass`);
    expect(ns.rows).toEqual([{ n: "domains" }]);
    const w = await t.pool.query<{ now: boolean; tomorrow: boolean }>(
      `select bool_or(now() >= lo and now() < hi) as now, bool_or(now() + interval '1 day' >= lo and now() + interval '1 day' < hi) as tomorrow
         from (select substring(pg_get_expr(k.relpartbound, k.oid) from 'FROM \\(''([^'']+)''\\)')::timestamptz as lo,
                      substring(pg_get_expr(k.relpartbound, k.oid) from 'TO \\(''([^'']+)''\\)')::timestamptz as hi
                 from pg_inherits i join pg_class k on k.oid = i.inhrelid where i.inhparent = '${S}'::regclass) b`,
    );
    expect(w.rows[0]).toEqual({ now: true, tomorrow: true });
    // The BRIN of a day partition is set to autosummarize, as the public tick tables' are.
    const brin = await t.pool.query<{ n: number }>(
      `select count(*)::int as n from pg_inherits i join pg_index x on x.indrelid = i.inhrelid join pg_class ic on ic.oid = x.indexrelid join pg_am am on am.oid = ic.relam
        where i.inhparent = '${S}'::regclass and am.amname = 'brin' and 'autosummarize=on' = any(coalesce(ic.reloptions, '{}'))`,
    );
    expect(brin.rows[0]?.n).toBe(34);
  });

  it("the partition helper keeps both schemas: a second run makes nothing, a missing day of a domain tick table is made again", async () => {
    await t.planted(async (c) => {
      const notes: string[] = [];
      c.on("notice", (m) => notes.push(m.message ?? ""));
      await c.query("select ensure_daily_partitions(30)");
      expect(notes.at(-1)).toMatch(/^ensure_daily_partitions: \d+ table\(s\) on the daily schedule in schema\(s\) public, domains, days .* 0 partition\(s\) created/);
      const day = (await c.query<{ d: string }>("select to_char(current_date + 5, 'YYYYMMDD') as d")).rows[0]?.d ?? "";
      await c.query(`alter table ${S} detach partition domains.charging_point_status_${day}`);
      await c.query(`drop table domains.charging_point_status_${day}`);
      await c.query("select ensure_daily_partitions(30)");
      expect(notes.at(-1)).toMatch(/ 1 partition\(s\) created/);
      expect((await c.query(`select to_regclass('domains.charging_point_status_${day}') is not null as ok`)).rows).toEqual([{ ok: true }]);
    });
  });

  it("the partition helper refuses a range-partitioned domain table that is not keyed on observed_at, naming its schema", async () => {
    await t.planted(async (c) => {
      await c.query("create table domains.vf_probe (k int) partition by range (k)");
      const e = await refusal(c.query("select ensure_daily_partitions()"));
      expect(e?.code).toBe("P0001");
      expect(e?.message).toMatch(/^ensure_daily_partitions: range-partitioned table\(s\) outside the daily schedule in schema domains: vf_probe partitioned by RANGE \(k\)\. /);
    });
  });

  it("records the twin's retention for the domains tick table, and the helper refuses a domains tick table without one", async () => {
    const r = await t.pool.query<{ schema_name: string; table_name: string; keep_days: number; archive: boolean }>("select schema_name, table_name, keep_days, archive from partition_retention where table_name = 'charging_point_status' order by 1, 2");
    expect(r.rows).toEqual([{ schema_name: "domains", table_name: "charging_point_status", keep_days: 14, archive: true }]);
    // Every domains tick table has its row.
    const missing = await t.pool.query<{ t: string }>(
      `select c.relname as t from pg_partitioned_table p join pg_class c on c.oid = p.partrelid
        where c.relnamespace = 'domains'::regnamespace and not exists (select 1 from partition_retention r where r.schema_name = 'domains' and r.table_name = c.relname)`,
    );
    expect(missing.rows).toEqual([]);
    await t.planted(async (c) => {
      await c.query("create table domains.vf_ticks (observed_at timestamptz not null) partition by range (observed_at)");
      const e = await refusal(c.query("select ensure_daily_partitions()"));
      expect(e?.message).toBe(
        "ensure_daily_partitions: tick table(s) of schema domains without a row in partition_retention: vf_ticks. Add the row (how many days a day partition is kept, and whether it is archived first) in the migration that creates the table.",
      );
    });
    await t.planted(async (c) => {
      for (const [sql, word] of [
        ["insert into partition_retention values ('domains', 'x', 0, true, 'r')", "partition_retention_keep_days"],
        ["insert into partition_retention values ('domains', 'x', 1, true, '')", "partition_retention_reason"],
        ["insert into partition_retention values ('domains', 'charging_point_status', 1, true, 'r')", "partition_retention_pkey"],
      ] as const) {
        await c.query("savepoint s");
        expect((await refusal(c.query(sql)))?.message, word).toContain(word);
        await c.query("rollback to savepoint s");
      }
    });
    expect((await t.readable(["public.partition_retention"])).open).toEqual([]);
  });

  it("the partition helper still refuses a public schema below its floor", async () => {
    await t.planted(async (c) => {
      await c.query("savepoint s");
      await c.query("update partition_settings set min_daily_tables = 1000");
      const e = await refusal(c.query("select ensure_daily_partitions()"));
      await c.query("rollback to savepoint s");
      expect(e?.message).toMatch(/^ensure_daily_partitions: \d+ range-partitioned table\(s\) keyed on observed_at in schema public, expected at least 1000 /);
      await c.query("delete from partition_settings");
      expect((await refusal(c.query("select ensure_daily_partitions()")))?.message).toMatch(/^ensure_daily_partitions: no row in partition_settings/);
    });
  });

  it("has the constraints and indexes of the convention, a tick table's owner key and primary key carrying observed_at", async () => {
    const own = /T_(geom_point|refill_nonempty|address_object|brin|evse) /;
    const cameras = (await t.convention()).filter((d) => !/T_(owner_key|pkey) /.test(d));
    const status = await t.shape("charging_point_status");
    expect(status.filter((d) => own.test(d))).toEqual([
      "CREATE INDEX T_brin ON ONLY domains.T USING brin (observed_at)",
      "CREATE INDEX T_evse ON ONLY domains.T USING btree (evse_id, observed_at DESC) WHERE (evse_id IS NOT NULL)",
      "c T_geom_point CHECK (((geom IS NULL) OR (geometrytype(geom) = 'POINT'::text)))",
    ]);
    expect(status.filter((d) => /T_(owner_key|pkey) /.test(d))).toEqual([
      "CREATE UNIQUE INDEX T_owner_key ON ONLY domains.T USING btree (source_id, feed, external_id, observed_at)",
      "CREATE UNIQUE INDEX T_pkey ON ONLY domains.T USING btree (id, observed_at)",
      "p T_pkey PRIMARY KEY (id, observed_at)",
      "u T_owner_key UNIQUE (source_id, feed, external_id, observed_at)",
    ]);
    expect(status.filter((d) => !own.test(d) && !/T_(owner_key|pkey) /.test(d)).map((d) => d.replace(" ON ONLY ", " ON "))).toEqual(cameras);
    const h2 = await t.shape("hydrogen_stations");
    expect(h2.filter((d) => own.test(d))).toEqual([
      "c T_address_object CHECK (((address IS NULL) OR (jsonb_typeof(address) = 'object'::text)))",
      "c T_geom_point CHECK (((geom IS NULL) OR (geometrytype(geom) = 'POINT'::text)))",
      "c T_refill_nonempty CHECK (((jsonb_typeof(refill) = 'array'::text) AND (jsonb_array_length(refill) > 0)))",
    ]);
    expect(h2.filter((d) => !own.test(d))).toEqual(await t.convention());
  });

  it("enables and forces row-level security; the state table has the policies of speed_cameras, the tick table no update policy", async () => {
    expect(await t.rls("charging_point_status")).toEqual({ e: true, f: true });
    expect(await t.rls("hydrogen_stations")).toEqual({ e: true, f: true });
    const cameras = await t.policies("speed_cameras");
    expect(await t.policies("hydrogen_stations")).toEqual(cameras);
    expect(await t.policies("charging_point_status")).toEqual(cameras.filter((p) => p.cmd !== "UPDATE"));
  });

  it("has a merged view for the state table only", async () => {
    expect((await t.columnsOf("hydrogen_stations_merged")).map((x) => x.column_name)).toEqual([...SYSTEM, ...Object.keys(HYDROGEN), ...MERGE_COLUMNS]);
    expect(await t.columnsOf("charging_point_status_merged")).toEqual([]);
  });

  it("grants the ingestor select and insert on the ticks, what speed_cameras grants on the state table, and no reader anything", async () => {
    const rels = ["charging_point_status", "hydrogen_stations", "hydrogen_stations_merged", "speed_cameras", "speed_cameras_merged"];
    const g = await t.grants(rels);
    expect(g.get("charging_point_status")).toEqual(["viafrei_ingestor:INSERT,SELECT"]);
    expect(g.get("hydrogen_stations")).toEqual(g.get("speed_cameras"));
    expect(g.get("hydrogen_stations_merged")).toEqual(g.get("speed_cameras_merged"));
    expect(g.get("hydrogen_stations")).toEqual(["viafrei_ingestor:INSERT,SELECT,UPDATE"]);
    // A day partition carries no grant of its own: it is reached through its parent only.
    const part = await t.pool.query<{ n: number }>(`select count(*)::int as n from pg_inherits i join pg_class k on k.oid = i.inhrelid where i.inhparent = '${S}'::regclass and k.relacl is not null`);
    expect(part.rows[0]?.n).toBe(0);
    const r = await t.readable([S, H, `${H}_merged`]);
    expect(r.checked).toBe(15);
    expect(r.open).toEqual([]);
  });

  it("appends status ticks: a repeat of the same observation is a no-op, a later one is a new row, and nothing is updated", async () => {
    await t.asSource("status-a", async (c) => {
      expect((await append(c, "status-a", [TICK])).rows).toEqual([{ inserted: true }]);
      expect((await append(c, "status-a", [TICK])).rows).toEqual([]);
      expect((await append(c, "status-a", [{ ...TICK, observed_at: at(5), status: "CHARGING", source_run_id: 8 }])).rows).toEqual([{ inserted: true }]);
      const r = await c.query<Record<string, unknown>>(
        `select external_id, evse_id, status, exchange_protocol, source_run_id::int as run, feed_ts = $1::timestamptz as feed_ts, last_updated = $2::timestamptz as last_updated
           from ${S} order by observed_at`,
        [TICK["feed_ts"], TICK["last_updated"]],
      );
      expect(r.rows).toEqual([
        { external_id: "DE*ABC*E1*1", evse_id: "DE*ABC*E1*1", status: "AVAILABLE", exchange_protocol: "deltaPull", run: 7, feed_ts: true, last_updated: true },
        { external_id: "DE*ABC*E1*1", evse_id: "DE*ABC*E1*1", status: "CHARGING", exchange_protocol: "deltaPull", run: 8, feed_ts: true, last_updated: true },
      ]);
      await c.query("savepoint s");
      expect((await refusal(c.query(`update ${S} set status = 'X'`)))?.code).toBe("42501");
      await c.query("rollback to savepoint s");
      expect((await refusal(c.query(`delete from ${S}`)))?.code).toBe("42501");
    });
  });

  it("refuses a tick for another source, for a source of another domain, without a source, with an empty key, a line or no day partition", async () => {
    await t.asSource("status-a", async (c) => {
      expect((await refusal(append(c, "status-b", [TICK])))?.code).toBe("42501");
    });
    await t.asSource("cameras-only", async (c) => {
      expect((await refusal(append(c, "cameras-only", [TICK])))?.code).toBe("42501");
    });
    await t.asSource(null, async (c) => {
      expect((await refusal(append(c, "status-a", [TICK])))?.code).toBe("42501");
    });
    await t.asSource("status-a", async (c) => {
      for (const [row, code, word] of [
        [{ ...TICK, external_id: "" }, "23514", "charging_point_status_external_id_check"],
        [{ ...TICK, geom_wkt: "LINESTRING(13 52, 13.1 52.1)" }, "23514", "charging_point_status_geom_point"],
        // No default partition: a tick a year ahead is refused, not parked.
        [{ ...TICK, observed_at: at(365 * 24 * 60) }, "23514", "no partition of relation"],
      ] as const) {
        await c.query("savepoint s");
        const e = await refusal(append(c, "status-a", [row]));
        await c.query("rollback to savepoint s");
        expect(e?.code, word).toBe(code);
        expect(e?.message, word).toContain(word);
      }
    });
  });

  it("finds a point's newest status through the evse index", async () => {
    await t.planted(async (c) => {
      await c.query(
        `insert into ${S} (source_id, external_id, evse_id, observed_at, status)
         select 'status-a', 'E' || g, 'E' || g, now() - (g % 48) * interval '1 hour', 'AVAILABLE' from generate_series(1, 5000) g`,
      );
      await c.query(`analyze ${S}`);
      await c.query("set local enable_seqscan = off");
      const plan = await c.query<{ "QUERY PLAN": string }>(
        `explain select status, observed_at from ${S} where evse_id = 'E42' and observed_at > now() - interval '24 hours' order by observed_at desc limit 1`,
      );
      expect(plan.rows.map((x) => x["QUERY PLAN"]).join("\n")).toMatch(/charging_point_status_\d{8}_evse_id_observed_at_idx/);
    });
  });

  it("takes a hydrogen station through the ingestor's upsert, and an unchanged one moves no row", async () => {
    await t.asSource("h2-high", async (c) => {
      expect((await upsert(c, "h2-high", [STATION])).rows).toEqual([{ inserted: true }]);
      expect((await upsert(c, "h2-high", [STATION])).rows).toEqual([]);
      const before = (await c.query<{ u: string }>(`select updated_at::text as u from ${H}`)).rows[0]?.u;
      expect((await upsert(c, "h2-high", [{ ...STATION, refill: [{ pressure: "350 bar", vehicle: "bus", state: "open" }] }])).rows).toEqual([{ inserted: false }]);
      const after = await c.query<{ moved: boolean }>(`select updated_at > $1::timestamptz as moved from ${H}`, [before]);
      expect(after.rows).toEqual([{ moved: true }]);
      await upsert(c, "h2-high", [STATION]);
      const r = await c.query<Record<string, unknown>>(`select external_id, name, address, refill, opening, provider_updated_at = '2026-11-10T08:00:00Z' as at, ST_AsText(geom) as wkt from ${H}`);
      expect(r.rows).toEqual([
        { external_id: "H2-1", name: "H2 Musterstadt", address: STATION["address"], refill: STATION["refill"], opening: { always: true }, at: true, wkt: "POINT(9.993682 53.551086)" },
      ]);
    });
  });

  it("refuses a station without refill points, with refill points that are not a list, an address that is not an object, a line, or an empty key", async () => {
    await t.asSource("h2-high", async (c) => {
      for (const [row, code, word] of [
        [{ ...STATION, refill: null }, "23502", "refill"],
        [{ ...STATION, refill: [] }, "23514", "hydrogen_stations_refill_nonempty"],
        [{ ...STATION, refill: { pressure: "700 bar" } }, "23514", "hydrogen_stations_refill_nonempty"],
        [{ ...STATION, address: "Hafenstraße 1" }, "23514", "hydrogen_stations_address_object"],
        [{ ...STATION, geom_wkt: "LINESTRING(13 52, 13.1 52.1)" }, "23514", "hydrogen_stations_geom_point"],
        [{ ...STATION, external_id: "" }, "23514", "hydrogen_stations_external_id_check"],
      ] as const) {
        await c.query("savepoint s");
        const e = await refusal(upsert(c, "h2-high", [row]));
        await c.query("rollback to savepoint s");
        expect(e?.code, word).toBe(code);
        expect(e?.message, word).toContain(word);
      }
    });
  });

  it("refuses a station write for another source, a source of another domain, and without a source", async () => {
    await t.asSource("h2-high", async (c) => {
      expect((await refusal(upsert(c, "h2-low", [STATION])))?.code).toBe("42501");
    });
    await t.asSource("status-a", async (c) => {
      expect((await refusal(upsert(c, "status-a", [STATION])))?.code).toBe("42501");
    });
    await t.asSource(null, async (c) => {
      expect((await refusal(upsert(c, "h2-high", [STATION])))?.code).toBe("42501");
    });
  });

  it("lets a source close only its own stations", async () => {
    await t.asSource("h2-high", async (c) => {
      await upsert(c, "h2-high", [STATION]);
      await c.query("select set_config('viafrei.source_id', 'h2-low', true)");
      await upsert(c, "h2-low", [STATION]);
      const closed = await c.query(`update ${H} set closed_at = clock_timestamp() where feed = 'default' and closed_at is null and not (external_id = any($1::text[]))`, [["none"]]);
      expect(closed.rowCount).toBe(1);
      const r = await c.query<{ source_id: string; open: boolean }>(`select source_id, closed_at is null as open from ${H} order by source_id`);
      expect(r.rows).toEqual([
        { source_id: "h2-high", open: true },
        { source_id: "h2-low", open: false },
      ]);
    });
  });

  const merged = async (c: pg.PoolClient, key: string): Promise<{ source_id: string; source_count: number; trust: number | null }[]> =>
    (await c.query<{ source_id: string; source_count: number; trust: number | null }>(`select source_id, source_count, trust from ${H}_merged where entity_key = $1`, [key])).rows;
  const plant = (c: pg.PoolClient, source: string, external: string, key: string, observed: string, closed: boolean): Promise<unknown> =>
    c.query(
      `insert into ${H} (source_id, external_id, match_key, observed_at, closed_at, refill)
       values ($1, $2, $3, $4::timestamptz, case when $5 then clock_timestamp() end, '[{}]')`,
      [source, external, key, observed, closed],
    );

  it("merges open stations by trust, then freshness; a closed row gives way; an unregistered source ranks last", async () => {
    await t.planted(async (c) => {
      await plant(c, "h2-high", "A", "K1", "2026-11-01T00:00:00Z", false);
      await plant(c, "h2-low", "B", "K1", "2026-11-05T00:00:00Z", false);
      expect(await merged(c, "K1")).toEqual([{ source_id: "h2-high", source_count: 2, trust: 80 }]);
      await plant(c, "h2-high", "C", "K2", "2026-11-01T00:00:00Z", true);
      await plant(c, "h2-low", "D", "K2", "2026-11-01T00:00:00Z", false);
      expect(await merged(c, "K2")).toEqual([{ source_id: "h2-low", source_count: 1, trust: 20 }]);
      await plant(c, "h2-high", "E", "K3", "2026-11-01T00:00:00Z", true);
      expect(await merged(c, "K3")).toEqual([]);
      await plant(c, "h2-high", "F", "K4", "2026-11-02T00:00:00Z", false);
      await plant(c, "h2-peer", "G", "K4", "2026-11-03T00:00:00Z", false);
      await plant(c, "h2-high", "H", "K5", "2026-11-03T00:00:00Z", false);
      await plant(c, "h2-peer", "I", "K5", "2026-11-02T00:00:00Z", false);
      expect(await merged(c, "K4")).toEqual([{ source_id: "h2-peer", source_count: 2, trust: 80 }]);
      expect(await merged(c, "K5")).toEqual([{ source_id: "h2-high", source_count: 2, trust: 80 }]);
      await plant(c, "h2-unknown", "J", "K6", "2026-11-05T00:00:00Z", false);
      expect(await merged(c, "K6")).toEqual([{ source_id: "h2-unknown", source_count: 1, trust: null }]);
      await plant(c, "h2-low", "K", "K6", "2026-11-01T00:00:00Z", false);
      expect(await merged(c, "K6")).toEqual([{ source_id: "h2-low", source_count: 2, trust: 20 }]);
    });
  });

  it("leaves the old tables as the baseline made them: the same columns and constraints", async () => {
    for (const table of ["charging_point_status", "charging_status_runs", "hydrogen_stations"]) {
      const a = await t.baselineAgreement(table);
      expect(a.baseline.columns.length, table).toBeGreaterThan(5);
      expect(a.catalogue, table).toEqual(a.baseline);
    }
    // The old tick table is still on the daily schedule of its own schema.
    const kids = await t.pool.query<{ n: number }>("select count(*)::int as n from pg_inherits where inhparent = 'public.charging_point_status'::regclass");
    expect(kids.rows[0]?.n).toBe(34);
  });
});
