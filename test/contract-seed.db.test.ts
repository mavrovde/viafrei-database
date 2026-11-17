/**
 * `test-fixtures seed FILE` (#29, for viafrei-api's integration tests): the
 * INSTEAD OF INSERT triggers of db/test-fixtures/contract_seed.sql write the
 * platform tables a contract view reads, so the API seeds its test database
 * in the contract's own words.
 *
 *   round trip   every contract relation but contract_info takes a seeded row,
 *                and reads it back as given, source_ref unchanged; the check
 *                here is a typed copy of the statement's row, independent of
 *                the trigger's own read-back;
 *   refusals     a row the view cannot read back names the column; a second
 *                seed is refused and changes nothing; contract_info is never
 *                seeded; api_reader inserts nothing; the file refuses a
 *                database not named test_*.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED_FILE } from "../src/fixtures.js";
import { psqlRunner } from "../src/psql.js";
import { DomainDb } from "./domain-db.js";
import { REPO } from "./helpers.js";

const base = process.env["TEST_DATABASE_URL"] ?? "";
const db = new DomainDb(base, "seed");
const SAMPLE = join("test", "seed", "contract-seed.sql");

type Stmt = { relation: string; columns: string; values: string };
const STATEMENTS: Stmt[] = [...readFileSync(join(REPO, SAMPLE), "utf8").matchAll(/^insert into contract\.([a-z_]+) \(([^)]*)\) values (.*);$/gm)].map((m) => ({
  relation: m[1] ?? "",
  columns: m[2] ?? "",
  values: m[3] ?? "",
}));
const RELATIONS = [...new Set(STATEMENTS.map((s) => s.relation))].sort();

function seed(env: Record<string, string>, file: string = SAMPLE): { code: number; out: string } {
  const r = spawnSync("npx", ["tsx", "src/cli.ts", "test-fixtures", "seed", file], { cwd: REPO, encoding: "utf8", env: { ...process.env, VF_TEST_FIXTURES: "", ...env } });
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
}

const code = (e: unknown): string => (e as { code?: string }).code ?? "?";

beforeAll(async () => {
  await db.make([]);
  const first = seed({ DATABASE_URL: db.url, VF_TEST_FIXTURES: "1" });
  expect(first, first.out).toMatchObject({ code: 0 });
  expect(first.out).toContain(`✓ test fixtures: ${String(STATEMENTS.length)} contract insert(s) seeded from contract-seed.sql`);
}, 180_000);
afterAll(async () => {
  await db.drop();
});

describe("test-fixtures seed: the round trip", () => {
  it("the sample seeds every contract relation but contract_info and transit_punctuality (both computed by the migrations)", async () => {
    const r = await db.pool.query<{ v: string }>("select relname as v from pg_class where relnamespace = 'contract'::regnamespace and relkind = 'v' and relname not in ('contract_info', 'transit_punctuality') order by 1");
    expect(RELATIONS).toEqual(r.rows.map((x) => x.v));
  });

  it.each(RELATIONS)("contract.%s reads back each seeded row as given, source_ref unchanged", async (relation) => {
    const c = await db.pool.connect();
    try {
      for (const s of STATEMENTS.filter((x) => x.relation === relation)) {
        await c.query("begin");
        await c.query(`create temp table given (like contract.${relation}) on commit drop`);
        await c.query(`insert into given (${s.columns}) values ${s.values}`);
        const r = await c.query<{ n: string; ref: string | null; read: string | null }>(
          `select (select count(*) from contract.${relation} v, given g where to_jsonb(v) @> jsonb_strip_nulls(to_jsonb(g)))::text as n,
                  (select to_jsonb(g) ->> 'source_ref' from given g) as ref,
                  (select to_jsonb(v) ->> 'source_ref' from contract.${relation} v, given g where to_jsonb(v) @> jsonb_strip_nulls(to_jsonb(g)) limit 1) as read`,
        );
        await c.query("rollback");
        expect(Number(r.rows[0]?.n), `${relation}: ${s.values}`).toBeGreaterThanOrEqual(1);
        const row = r.rows[0];
        if (row !== undefined && row.ref !== null) expect(row.read).toBe(row.ref);
      }
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});

describe("test-fixtures seed: a live departure", () => {
  it("a departure seeded with a realtime source reads back with its figure, its platform and its carriers", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      const day = (await c.query<{ d: string }>("select to_char((now() at time zone 'Europe/Berlin')::date, 'YYYYMMDD') as d")).rows[0]?.d ?? "";
      const at = "date_trunc('minute', now()) + interval '40 minutes'";
      for (const [trip, src, extra] of [
        ["seed-rt1", "delfi_siri_et", "platform, delay_min, train_category"],
        ["seed-rt2", "delfi_rt_tu", "cancelled"],
      ] as const) {
        const vals = src === "delfi_siri_et" ? "'7', 3, 'IC'" : "true";
        await c.query(
          `insert into contract.departure (stop_point_id, journey_id, call_order, line_id, line_name, transport_mode, destination_label, planned_departure_at, planned_platform, realtime_source, source_ref, ${extra})
           values ('1:de:09162:live:${trip}', '1:${trip}:${day}', 2, '1:${trip}-line', 'IC 2013', 'rail', 'Stuttgart Hbf', ${at}, '5', '${src}', 'delfi_static', ${vals})`,
        );
      }
      const r = await c.query("select journey_id, realtime, delay_min, cancelled, platform, platform_changed, source_refs from contract.departure where journey_id like '1:seed-rt%' order by 1");
      expect(r.rows).toEqual([
        { journey_id: `1:seed-rt1:${day}`, realtime: true, delay_min: 3, cancelled: false, platform: "7", platform_changed: true, source_refs: ["delfi_static", "delfi_siri_et"] },
        { journey_id: `1:seed-rt2:${day}`, realtime: true, delay_min: null, cancelled: true, platform: "5", platform_changed: false, source_refs: ["delfi_static", "delfi_rt_tu"] },
      ]);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});

describe("test-fixtures seed: the platform's own readers", () => {
  it("each station's newest price per grade is the latest row the platform's fuel readers read, with the station's open state", async () => {
    const r = await db.pool.query<{ missing: string; extra: string; n: string }>(
      `with newest as (select distinct on (o.station_id, o.product_code) o.station_id, o.product_code, o.price, o.observed_at, o.source_ref
                         from contract.fuel_price_observation o order by o.station_id, o.product_code, o.observed_at desc)
       select (select count(*) from newest n where not exists (select 1 from public.fuel_price_latest l
                 join public.fuel_stations s on s.id = l.station_id
                where l.station_id = n.station_id and l.product = n.product_code and l.price = n.price and l.observed_at = n.observed_at
                  and l.source_feed = coalesce(n.source_ref, 'tankerkoenig') and l.is_open is not distinct from (s.state = 'open')))::text as missing,
              (select count(*) from public.fuel_price_latest l where not exists (select 1 from newest n where n.station_id = l.station_id and n.product_code = l.product))::text as extra,
              (select count(*) from newest)::text as n`,
    );
    expect(r.rows[0]).toMatchObject({ missing: "0", extra: "0" });
    expect(Number(r.rows[0]?.n)).toBeGreaterThan(0);
  });
});

describe("test-fixtures seed: the refusals", () => {
  it("a row the contract cannot read back as given is refused, naming the column, and writes nothing", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      const before = await c.query<{ n: string }>("select count(*)::text as n from public.tmc_locations");
      const e = await c
        .query("insert into contract.junction (junction_id, road_ref, junction_kind) values ('58:1:4712', 'A99', 'exit')")
        .then(() => null, (x: unknown) => x as { code?: string; message: string });
      expect(e?.code).toBe("22023");
      expect(e?.message).toContain("contract.junction shows no row with junction_id = \"58:1:4712\": the view's own conditions leave the row out");
      await c.query("rollback");
      await c.query("begin");
      const kind = await c
        .query("insert into contract.junction (junction_id, road_ref, name, junction_kind) values ('58:1:4712', 'A99', 'Seed-Süd', 'exit')")
        .then(() => null, (x: unknown) => x as { code?: string; message: string });
      expect(kind?.code).toBe("22023");
      expect(kind?.message).toBe('vf_test contract seed: contract.junction cannot hold junction_kind = "exit" (reads back as "junction")');
      await c.query("rollback");
      const after = await c.query<{ n: string }>("select count(*)::text as n from public.tmc_locations");
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("a second seed is refused and changes nothing", async () => {
    const count = async (): Promise<string> => (await db.pool.query<{ n: string }>("select (select count(*) from contract.fuel_price_observation) || ':' || (select count(*) from vf_test.contract_seed_runs) as n")).rows[0]?.n ?? "";
    const before = await count();
    const again = seed({ DATABASE_URL: db.url, VF_TEST_FIXTURES: "1" });
    expect(again.code).toBe(1);
    expect(again.out).toContain("this database was seeded already (contract-seed.sql)");
    expect(await count()).toBe(before);
  });

  it("contract_info is never seeded, and api_reader inserts into no contract view", async () => {
    expect(await db.pool.query("insert into contract.contract_info (contract_version) values ('9.9.9')").then(() => "ok", code)).toBe("0A000");
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role api_reader");
      expect(await c.query("insert into contract.road (road_ref) values ('A98')").then(() => "ok", code)).toBe("42501");
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("without VF_TEST_FIXTURES=1, or for a database not named test_*, the verb exits 2 and seeds nothing", () => {
    expect(seed({ DATABASE_URL: db.url })).toMatchObject({ code: 2 });
    const other = new URL(base);
    other.pathname = "/viafrei";
    const r = seed({ DATABASE_URL: other.toString(), VF_TEST_FIXTURES: "1" });
    expect(r.code).toBe(2);
    expect(r.out).toContain("test-fixtures seed refuses the database 'viafrei'");
  });

  it("the file itself refuses a server whose database is not test_*, and creates nothing there", async () => {
    const other = new URL(base);
    other.pathname = "/postgres";
    const run = psqlRunner({ databaseUrl: other.toString() });
    const count = async (): Promise<string> => (await run("select count(*) from pg_namespace where nspname = 'vf_test';", ["-At"])).stdout.trim();
    const before = await count();
    const r = await run(readFileSync(SEED_FILE, "utf8"), ["-1", "-f", "-"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/vf_test contract seed is for a test_ database only, not postgres/);
    expect(await count()).toBe(before);
  });
});
