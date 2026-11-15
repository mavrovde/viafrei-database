/**
 * The test-only fixture functions of db/test-fixtures/vf_test.sql and the
 * `test-fixtures install` verb (#31 item 9), both directions:
 *
 *   never by default  a database `migrate`/`serve` made holds no vf_test, and
 *                     no source file but the verb's reads the fixture file;
 *   refusals          the verb refuses (exit 2) without VF_TEST_FIXTURES=1 and
 *                     for a database not named test_*, before psql runs; the
 *                     file refuses on a server whose database is not test_*;
 *   the gate          every function refuses outside an explicit transaction,
 *                     and without `set local vf_test.armed = 'on'`;
 *   one guard each    inside an armed transaction each function lifts exactly
 *                     the guard it names (the catalogue's guards differ in that
 *                     one entry), the lift acts, and the rollback restores it.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES_FILE, fixturesRefusal, installFixtures } from "../src/fixtures.js";
import { psqlRunner } from "../src/psql.js";
import { DomainDb } from "./domain-db.js";
import { REPO } from "./helpers.js";

const base = process.env["TEST_DATABASE_URL"] ?? "";
const db = new DomainDb(base, "fixtures");

/** The verb as an operator runs it. */
function verb(env: Record<string, string>): { code: number; out: string } {
  const r = spawnSync("npx", ["tsx", "src/cli.ts", "test-fixtures", "install"], { cwd: REPO, encoding: "utf8", env: { ...process.env, VF_TEST_FIXTURES: "", ...env } });
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
}

beforeAll(async () => {
  await db.make([]);
}, 120_000);
afterAll(async () => {
  await db.drop();
});

/** Every guard of the catalogue, as lines: triggers and their state, constraints, column options, relation ACLs. */
async function guards(c: pg.ClientBase): Promise<Set<string>> {
  // Read with an empty search_path, so a name prints schema-qualified whatever path the lift set; the path is put back.
  const path = (await c.query<{ p: string }>("select current_setting('search_path') as p")).rows[0]?.p ?? "";
  await c.query("select set_config('search_path', '', false)");
  const r = await c.query<{ l: string }>(
    `select 'trigger ' || tgrelid::regclass || ' ' || tgname || ' ' || tgenabled::text as l from pg_trigger where not tgisinternal
     union all select 'constraint ' || conrelid::regclass || ' ' || conname from pg_constraint where conrelid <> 0
     union all select 'option ' || attrelid::regclass || ' ' || attname || ' ' || array_to_string(attoptions, ',') from pg_attribute where attoptions is not null
     union all select 'acl ' || c.oid::regclass || ' ' || coalesce(c.relacl::text, '-') from pg_class c
                where c.relkind in ('r', 'v', 'm', 'p') and c.relnamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
                  and not c.relispartition and c.relnamespace <> 'vf_test_shadow'::regnamespace`,
  );
  await c.query("select set_config('search_path', $1, false)", [path]);
  return new Set(r.rows.map((x) => x.l));
}

/** In one rolled-back, armed transaction: the guards before, `lift`, the guards after, then `act`. */
async function armed<T>(lift: string, act: (c: pg.PoolClient) => Promise<T>, values: unknown[] = []): Promise<{ gone: string[]; added: string[]; result: T }> {
  const c = await db.pool.connect();
  try {
    await c.query("begin");
    await c.query("set local vf_test.armed = 'on'");
    const before = await guards(c);
    await c.query(lift, values);
    const after = await guards(c);
    const result = await act(c);
    return { gone: [...before].filter((l) => !after.has(l)), added: [...after].filter((l) => !before.has(l)), result };
  } finally {
    await c.query("rollback");
    c.release();
  }
}

const code = (e: unknown): string => (e as { code?: string }).code ?? "?";

describe("the fixtures are never installed by default", () => {
  it("a database migrate and serve made holds no vf_test, vf_test_clock or vf_test_shadow schema", async () => {
    const r = await db.pool.query<{ n: string }>("select nspname as n from pg_namespace where nspname like 'vf\\_test%' order by 1");
    expect(r.rows).toEqual([]);
  });

  it("no source file but the verb's names the fixture file", () => {
    const users = readdirSync(join(REPO, "src"), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts") && readFileSync(join(REPO, "src", f), "utf8").includes("test-fixtures"))
      .sort();
    expect(users).toEqual(["cli.ts", "fixtures.ts"]);
  });
});

describe("test-fixtures install refuses", () => {
  it("without VF_TEST_FIXTURES=1, and for a database not named test_*, with exit 2 before psql runs", async () => {
    const calls: string[] = [];
    const stub = (s: string | Buffer): Promise<{ code: number; stdout: string; stderr: string }> => {
      calls.push(String(s));
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    for (const env of [
      { DATABASE_URL: db.url },
      { DATABASE_URL: db.url, VF_TEST_FIXTURES: "yes" },
      { DATABASE_URL: "postgresql://x@127.0.0.1/viafrei", VF_TEST_FIXTURES: "1" },
      { DATABASE_URL: "postgresql://x@127.0.0.1/", VF_TEST_FIXTURES: "1" },
      { VF_TEST_FIXTURES: "1" },
    ]) {
      const r = await installFixtures(env, stub);
      expect(r.exitCode, JSON.stringify(env)).toBe(2);
      expect(fixturesRefusal(env)).not.toBeNull();
    }
    expect(calls).toEqual([]);
  });

  it("as a CLI verb: exit 2 without the variable, exit 2 for a sub-verb it does not know", () => {
    expect(verb({ DATABASE_URL: db.url })).toMatchObject({ code: 2 });
    const bad = spawnSync("npx", ["tsx", "src/cli.ts", "test-fixtures", "drop"], { cwd: REPO, encoding: "utf8" });
    expect(bad.status).toBe(2);
  });

  it("the file itself refuses a server whose database is not test_*, and creates nothing there", async () => {
    const other = new URL(base);
    other.pathname = "/postgres";
    // Compared before and after, not with 0: a mutant run (the refusal removed) installs on postgres and nothing drops it there.
    const count = async (): Promise<string> =>
      (await psqlRunner({ databaseUrl: other.toString() })("select count(*) || ':' || coalesce(string_agg(p.oid::text, ',' order by p.oid), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname like 'vf\\_test%';", ["-At"])).stdout.trim();
    const before = await count();
    const r = await psqlRunner({ databaseUrl: other.toString() })(readFileSync(FIXTURES_FILE, "utf8"), ["-1", "-f", "-"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/vf_test fixtures are for a test_ database only, not postgres/);
    expect(await count()).toBe(before);
  });
});

describe("installed on a test database", () => {
  beforeAll(() => {
    const first = verb({ DATABASE_URL: db.url, VF_TEST_FIXTURES: "1" });
    expect(first, first.out).toMatchObject({ code: 0 });
    // counted as the coverage gate counts them: every vf_test schema, the clock's included
    expect(first.out).toContain("✓ test fixtures: 12 vf_test function(s) installed");
    // Idempotent: a second install is the same install.
    expect(verb({ DATABASE_URL: db.url, VF_TEST_FIXTURES: "1" }).code).toBe(0);
  }, 120_000);

  it("every function refuses outside a transaction block and without the armed setting", async () => {
    const fns = ["vf_test.unfreeze_station_slugs()", "vf_test.lift_runtime_config_source_bounds()", "vf_test.revoke_select('public.station_slugs', 'viafrei_mcp')"];
    for (const f of fns) {
      // autocommit, armed for the session: still refused, a lift would commit.
      const c = await db.pool.connect();
      try {
        await c.query("set vf_test.armed = 'on'");
        expect(await c.query(`select ${f}`).then(() => "ok", code), f).toBe("25P01");
        await c.query("reset vf_test.armed");
        await c.query("begin");
        expect(await c.query(`select ${f}`).then(() => "ok", code), f).toBe("55000");
      } finally {
        await c.query("rollback");
        c.release();
      }
    }
    const t = await db.pool.query<{ e: string }>("select tgenabled as e from pg_trigger where tgname = 'station_slugs_frozen'");
    expect(t.rows[0]?.e).toBe("O");
  });

  it.each([
    ["vf_test.unfreeze_station_slugs()", "trigger public.station_slugs station_slugs_frozen"],
    ["vf_test.lift_runtime_config_source_bounds()", "trigger public.runtime_config runtime_config_source_bounds"],
    ["vf_test.lift_postcode_trigger('public.fuel_stations')", "trigger public.fuel_stations fuel_stations_postcode"],
  ])("%s disables exactly that trigger, and the rollback enables it again", async (lift, trigger) => {
    const r = await armed(`select ${lift}`, () => Promise.resolve(null));
    expect(r.gone).toEqual([`${trigger} O`]);
    expect(r.added).toEqual([`${trigger} D`]);
    expect((await guards(db.pool as unknown as pg.ClientBase)).has(`${trigger} O`)).toBe(true);
  });

  it("the unfrozen slugs take a delete the trigger refuses", async () => {
    const slug = async (c: pg.PoolClient): Promise<string> => {
      await c.query("savepoint s");
      return c.query("delete from station_slugs where slug = 'zz-1'").then(
        () => "ok",
        async (e: unknown) => {
          await c.query("rollback to savepoint s");
          return code(e);
        },
      );
    };
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      const cols = await c.query<{ a: string }>("select attname as a from pg_attribute where attrelid = 'public.station_slugs'::regclass and attnum > 0 and not attisdropped and attnotnull and not atthasdef");
      await c.query("set local session_replication_role = replica");
      await c.query(`insert into station_slugs (${cols.rows.map((x) => x.a).join(", ")}) values (${cols.rows.map(() => "'zz-1'").join(", ")})`);
      await c.query("set local session_replication_role = origin");
      expect(await slug(c)).not.toBe("ok");
      await c.query("set local vf_test.armed = 'on'");
      await c.query("select vf_test.unfreeze_station_slugs()");
      expect(await slug(c)).toBe("ok");
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("drop_check drops exactly that CHECK, and refuses a name that is not a CHECK", async () => {
    const r = await armed("select vf_test.drop_check('public.error_events', 'error_events_check')", () => Promise.resolve(null));
    expect(r.gone).toEqual(["constraint public.error_events error_events_check"]);
    expect(r.added).toEqual([]);
    const refused = await armed("select 1", (c) => c.query("select vf_test.drop_check('public.error_events', 'error_events_pkey')").then(() => "ok", code));
    expect(refused.result).toBe("42704");
  });

  it("set_n_distinct sets exactly that column's option", async () => {
    const r = await armed("select vf_test.set_n_distinct('public.stop_times', 'trip_id', -0.2)", () => Promise.resolve(null));
    expect(r.added.filter((l) => l.startsWith("option public.stop_times trip_id"))).toEqual(["option public.stop_times trip_id n_distinct=-0.2"]);
    expect(r.added.length + r.gone.length).toBe(r.gone.some((l) => l.startsWith("option public.stop_times trip_id")) ? 2 : 1);
  });

  it("revoke_select takes exactly one role's SELECT on one relation, and the rollback gives it back", async () => {
    const has = "select has_table_privilege('viafrei_mcp', 'public.parking_facilities_live', 'select') as h";
    const r = await armed("select vf_test.revoke_select('public.parking_facilities_live', 'viafrei_mcp')", async (c) => (await c.query<{ h: boolean }>(has)).rows[0]?.h);
    expect(r.result).toBe(false);
    expect(r.gone.map((l) => l.split(" ").slice(0, 2).join(" "))).toEqual(["acl public.parking_facilities_live"]);
    expect(r.added.map((l) => l.split(" ").slice(0, 2).join(" "))).toEqual(["acl public.parking_facilities_live"]);
    expect((await db.pool.query<{ h: boolean }>(has)).rows[0]?.h).toBe(true);
  });

  it("set_clock: an unqualified now() is the test's instant for this transaction, and nothing in the catalogue moves", async () => {
    const at = "2026-03-29 01:30:00+00";
    const r = await armed("select vf_test.set_clock($1)", async (c) => (await c.query<{ n: Date }>("select now() as n")).rows[0]?.n.toISOString(), [at]);
    expect(r.result).toBe("2026-03-29T01:30:00.000Z");
    expect([...r.gone, ...r.added]).toEqual([]);
    const after = (await db.pool.query<{ n: Date }>("select now() as n")).rows[0]?.n.getTime() ?? 0;
    expect(Math.abs(after - Date.now())).toBeLessThan(60_000);
  });

  it("shadow_slow: an unqualified read of the relation waits first, rows unchanged; shadow_rows: the role reads the test's rows", async () => {
    const slow = await armed("select vf_test.shadow_slow('public.station_slugs', 1)", async (c) => {
      const t0 = Date.now();
      const n = (await c.query<{ n: string }>("select count(*) as n from station_slugs")).rows[0]?.n;
      return { ms: Date.now() - t0, n };
    });
    expect(slow.result.ms).toBeGreaterThanOrEqual(1_000);
    expect(slow.result.n).toBe((await db.pool.query<{ n: string }>("select count(*) as n from public.station_slugs")).rows[0]?.n);
    expect([...slow.gone, ...slow.added]).toEqual([]);
    const rows = await armed("select vf_test.shadow_rows('public.registered_sources', $1)", async (c) => {
      await c.query("set local role viafrei_status");
      return (await c.query<{ s: string }>("select source_id as s from registered_sources order by 1")).rows.map((x) => x.s);
    }, [JSON.stringify([{ source_id: "zz-a", enabled: true }, { source_id: "zz-b", enabled: false }])]);
    expect(rows.result).toEqual(["zz-a", "zz-b"]);
    const ns = await db.pool.query("select 1 from pg_class where relnamespace = 'vf_test_shadow'::regnamespace");
    expect(ns.rows).toEqual([]);
  });
});
