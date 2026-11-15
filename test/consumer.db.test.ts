/**
 * What a consumer's tests used to build for themselves with DDL, held here
 * against a database this image migrates (viafrei-database #31, items 1–5):
 *
 *   1  the role settings reach every database migrate touches, a copy made
 *      from a template included (db/roles/settings.sql);
 *   2  the object comments of the original migrations are in a database the
 *      baseline starts (0303);
 *   3  `partitions ensure --days-back B / --from DATE` makes the past
 *      partitions a dated row needs (0304);
 *   4  `roles passwords` sets the role passwords outside serve, and each role
 *      then logs in with its settings in force (the readers' memory, jit);
 *   5  the partition machinery on a scratch schema: the window, the stray and
 *      floor refusals, BRIN autosummarize, attach rather than `partition of`.
 *
 * One database migrated through the service, and a copy of it made with
 * CREATE DATABASE … TEMPLATE, the way a test harness clones one per file.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { loadConfig } from "../src/config.js";
import { ROLES } from "../src/roles.js";
import { DatabaseService } from "../src/service.js";
import { endPool } from "./domain-db.js";
import { REPO } from "./helpers.js";
import { byRole, databaseSettings, parseSettings, settingsFile } from "./role-settings.js";

const ADMIN = process.env["TEST_DATABASE_URL"] ?? "";
const NAME = `test_vfdb_consumer_${String(process.pid)}`;
const CLONE = `${NAME}_copy`;
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const urlOf = (db: string, user?: string, password?: string): string => {
  const u = new URL(ADMIN);
  u.pathname = `/${db}`;
  if (user !== undefined) u.username = user;
  if (password !== undefined) u.password = password;
  return u.toString();
};
const service = (db: string): DatabaseService => new DatabaseService({ config: loadConfig({ DATABASE_URL: urlOf(db), DB_MIGRATE_LOCK_PAUSE_S: "1" }, "serve"), log: quiet });

let admin: pg.Pool;
let pool: pg.Pool;
let copy: pg.Pool;
let owner: string;

/** Runs the CLI with these variables set, its output kept off the test's own. */
async function cli(argv: string[], env: Record<string, string>): Promise<{ code: number; out: string }> {
  const saved = { ...process.env };
  const out: string[] = [];
  const o = vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true));
  const e = vi.spyOn(process.stderr, "write").mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true));
  Object.assign(process.env, env);
  try {
    return { code: await main(argv), out: out.join("") };
  } finally {
    o.mockRestore();
    e.mockRestore();
    process.env = saved;
  }
}

/** The settings pg_db_role_setting holds for one database, as role → sorted lower-cased `name=value`. */
async function heldSettings(db: string): Promise<Map<string, string[]>> {
  const r = await admin.query<{ role: string; s: string }>(
    `select r.rolname as role, lower(split_part(x, '=', 1)) || '=' || substr(x, strpos(x, '=') + 1) as s
       from pg_db_role_setting d join pg_roles r on r.oid = d.setrole cross join unnest(d.setconfig) x
      where d.setdatabase = (select oid from pg_database where datname = $1) order by 1, 2`,
    [db],
  );
  const out = new Map<string, string[]>();
  for (const x of r.rows) out.set(x.role, [...(out.get(x.role) ?? []), x.s]);
  return out;
}

const expected = (): Map<string, string[]> => byRole(parseSettings(settingsFile()), owner);

/** The database-wide settings (no role) pg_db_role_setting holds for one database. */
async function heldDatabaseSettings(db: string): Promise<string[]> {
  const r = await admin.query<{ s: string }>(
    "select x as s from pg_db_role_setting d cross join unnest(d.setconfig) x where d.setrole = 0 and d.setdatabase = (select oid from pg_database where datname = $1) order by 1",
    [db],
  );
  return r.rows.map((x) => x.s);
}

beforeAll(async () => {
  if (ADMIN === "") throw new Error("TEST_DATABASE_URL is not set");
  admin = new pg.Pool({ connectionString: ADMIN, max: 1 });
  owner = new URL(ADMIN).username;
  await admin.query(`drop database if exists ${CLONE} with (force)`);
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  const svc = service(NAME);
  await svc.boot(1_000);
  await svc.close();
  // The harness's shape: one migrated database, copied per test file.
  await admin.query(`create database ${CLONE} template ${NAME}`);
  pool = new pg.Pool({ connectionString: urlOf(NAME), max: 3 });
  copy = new pg.Pool({ connectionString: urlOf(CLONE), max: 2 });
});

afterAll(async () => {
  await endPool(pool);
  await endPool(copy);
  await admin.query(`drop database if exists ${CLONE} with (force)`);
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

describe("1 — the role settings reach every database migrate touches", () => {
  it("a migrated database holds exactly the role settings settings.sql names", async () => {
    expect(await heldSettings(NAME)).toEqual(expected());
  });

  it("a copy made from a template holds none of them until migrate runs on it, then exactly the source's", async () => {
    // pg_db_role_setting is keyed on the database: CREATE DATABASE … TEMPLATE copies none of it.
    expect((await heldSettings(CLONE)).size).toBe(0);
    const svc = service(CLONE);
    try {
      const m = await svc.migrate("cli");
      expect(m.ok).toBe(true);
      expect(m.lines.join("\n")).toMatch(/✓ 0 migration\(s\) applied/);
      expect(m.lines.join("\n")).toMatch(/role settings: 39 applied to this database/);
    } finally {
      await svc.close();
    }
    expect(await heldSettings(CLONE)).toEqual(expected());
  });

  it("the migrated database and its copy hold production's database-wide setting, PostGIS's search_path, and no other", async () => {
    const want = databaseSettings(settingsFile());
    expect(want).toEqual(['search_path="$user", public, topology, tiger']);
    expect(await heldDatabaseSettings(NAME)).toEqual(want);
    expect(await heldDatabaseSettings(CLONE)).toEqual(want);
  });

  it("roles settings applies them alone, and a migrate --dry-run applies none", async () => {
    for (const r of [owner, ...ROLES.map((x) => x.role)]) await admin.query(`alter role ${r} in database ${CLONE} reset all`);
    expect((await heldSettings(CLONE)).size).toBe(0);
    const dry = await cli(["migrate", "--dry-run"], { DATABASE_URL: urlOf(CLONE) });
    expect(dry.code).toBe(0);
    expect((await heldSettings(CLONE)).size).toBe(0);
    const r = await cli(["roles", "settings"], { DATABASE_URL: urlOf(CLONE) });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/role settings: 39 applied/);
    expect(await heldSettings(CLONE)).toEqual(expected());
  });
});

describe("4 — roles passwords, outside serve", () => {
  it("sets every role's password from VF_DB_ROLE_DIR; each role then logs in, with its memory, jit and timeout settings in force, and a wrong password is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vfdb-roles-"));
    const pw = new Map(ROLES.map((x) => [x.role, randomBytes(16).toString("hex")]));
    try {
      for (const [role, p] of pw) writeFileSync(join(dir, role), `${p}\n`, { mode: 0o600 });
      const r = await cli(["roles", "passwords"], { DATABASE_URL: urlOf(NAME), VF_DB_ROLE_DIR: dir });
      expect(r.code).toBe(0);
      for (const role of pw.keys()) expect(r.out).toContain(`${role}: password applied from the mounted secret`);
      // No password reaches the output.
      for (const p of pw.values()) expect(r.out).not.toContain(p);
      const want = expected();
      for (const [role, p] of pw) {
        const c = new pg.Client({ connectionString: urlOf(CLONE, role, p) });
        await c.connect();
        try {
          for (const kv of want.get(role) ?? []) {
            const [name = "", value = ""] = kv.split("=");
            // The server's own spelling of the value (300s is shown as 5min): set it locally as the owner and read it back.
            const shown = (await c.query<{ v: string }>("select current_setting($1) as v", [name])).rows[0]?.v;
            const k = await admin.connect();
            let spelled: string | undefined;
            try {
              await k.query("begin");
              await k.query("select set_config($1, $2, true)", [name, value]);
              spelled = (await k.query<{ v: string }>("select current_setting($1) as v", [name])).rows[0]?.v;
            } finally {
              await k.query("rollback");
              k.release();
            }
            expect(`${role} ${name}=${String(shown)}`).toBe(`${role} ${name}=${String(spelled)}`);
          }
        } finally {
          await c.end();
        }
      }
      const wrong = new pg.Client({ connectionString: urlOf(CLONE, "viafrei_mcp", "not-the-password-0000") });
      await expect(wrong.connect()).rejects.toMatchObject({ code: "28P01" });
      await wrong.end().catch(() => undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** The statements of 0303, each as the object type it names, its identity and the text it sets. */
function carried(): { keyword: string; identity: string; text: string }[] {
  const sql = readFileSync(join(REPO, "db", "migrations", "0303_carried_comments.sql"), "utf8");
  const out: { keyword: string; identity: string; text: string }[] = [];
  for (const m of sql.matchAll(/^COMMENT ON (COLUMN|TABLE|VIEW|MATERIALIZED VIEW|FUNCTION|INDEX|SCHEMA|CONSTRAINT) (.+?) IS (E?)'((?:[^']|'')*)';$/gms)) {
    const raw = (m[4] ?? "").replace(/''/g, "'");
    out.push({ keyword: m[1] ?? "", identity: m[2] ?? "", text: m[3] === "E" ? raw.replace(/\\\\/g, "\\") : raw });
  }
  return out;
}

describe("2 — the original migrations' comments are in a database the baseline starts (0303)", () => {
  it("every one of 0303's 740 statements is the description its object holds", async () => {
    const stmts = carried();
    const sql = readFileSync(join(REPO, "db", "migrations", "0303_carried_comments.sql"), "utf8");
    expect(stmts).toHaveLength(740);
    expect((sql.match(/^COMMENT ON /gm) ?? []).length).toBe(stmts.length);
    const r = await pool.query<{ type: string; identity: string; d: string }>(
      `select o.type, o.identity, d.description as d from pg_description d cross join lateral pg_identify_object(d.classoid, d.objoid, d.objsubid) o`,
    );
    const held = new Map<string, string>();
    for (const x of r.rows) {
      const kw = x.type.endsWith(" column") ? "COLUMN" : x.type === "table constraint" ? "CONSTRAINT" : x.type.toUpperCase();
      const id = x.type === "table constraint" ? x.identity.replace(/ on /, " ON ") : x.identity;
      held.set(`${kw} ${id}`, x.d);
    }
    const wrong = stmts.filter((s) => held.get(`${s.keyword} ${s.identity}`) !== s.text).map((s) => `${s.keyword} ${s.identity}`);
    expect(wrong).toEqual([]);
  });

  it("carries the descriptions consumers read: transit_delays, feed_runs.status, deployments, the soft-delete columns", async () => {
    const obj = async (rel: string): Promise<string> => (await pool.query<{ c: string | null }>("select obj_description($1::regclass, 'pg_class') as c", [rel])).rows[0]?.c ?? "";
    const col = async (rel: string, att: string): Promise<string> =>
      (await pool.query<{ c: string | null }>("select col_description($1::regclass, (select attnum from pg_attribute where attrelid = $1::regclass and attname = $2)) as c", [rel, att])).rows[0]?.c ?? "";
    const td = await obj("public.transit_delays");
    expect(td).toMatch(/CC BY-SA 4\.0/);
    expect(td).toMatch(/delfi_prefix|delfi_ prefix/);
    expect(await col("public.transit_delays", "delay_s")).toMatch(/NULL is a real state/);
    expect(await col("public.feed_runs", "status")).toContain("skipped (due, but the cycle's one request went to another feed)");
    expect(await obj("public.deployments")).toContain("deploy");
    const undescribed = await pool.query<{ a: string }>(
      "select attname as a from pg_attribute where attrelid = 'public.deployments'::regclass and attnum > 0 and not attisdropped and col_description(attrelid, attnum) is null",
    );
    expect(undescribed.rows).toEqual([]);
    for (const t of ["public.road_events", "public.charging_sites", "public.charging_points"]) expect(await col(t, "closed_at"), t).toMatch(/deleted_at/);
  });
});

/** The covered tables' partition for a date, by name. */
async function partitionsOn(c: pg.Pool | pg.PoolClient, day: string): Promise<{ covered: number; with: number }> {
  const r = await c.query<{ covered: number; with: number }>(
    `select count(*)::int as covered, count(to_regclass(format('%I.%I', n.nspname, c.relname || '_' || replace($1, '-', ''))))::int as with
       from pg_partitioned_table p join pg_class c on c.oid = p.partrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and p.partstrat = 'r'`,
    [day],
  );
  return r.rows[0] ?? { covered: 0, with: 0 };
}

describe("3 — partitions ensure --days-back / --from (0304)", () => {
  it("partitions ensure --from DATE through the CLI gives every tick table its partition for that day, and the one-argument form still reaches three days back", async () => {
    const day = (await copy.query<{ d: string }>("select to_char(current_date - 40, 'YYYY-MM-DD') as d")).rows[0]?.d ?? "";
    const before = await partitionsOn(copy, day);
    expect(before.covered).toBeGreaterThanOrEqual(10);
    expect(before.with).toBe(0);
    const r = await cli(["partitions", "ensure", "--from", day, "--days", "1"], { DATABASE_URL: urlOf(CLONE) });
    expect(r.code).toBe(0);
    expect(r.out).toContain(`✓ partitions ensured for today+1, from ${day}`);
    expect(await partitionsOn(copy, day)).toEqual({ covered: before.covered, with: before.covered });
    const back = await cli(["partitions", "ensure", "--days-back", "45", "--days", "0"], { DATABASE_URL: urlOf(CLONE) });
    expect(back.code).toBe(0);
    const d45 = (await copy.query<{ d: string }>("select to_char(current_date - 45, 'YYYY-MM-DD') as d")).rows[0]?.d ?? "";
    expect((await partitionsOn(copy, d45)).with).toBe(before.covered);
    const d4 = (await pool.query<{ d: string }>("select to_char(current_date - 4, 'YYYY-MM-DD') as d")).rows[0]?.d ?? "";
    await pool.query("select ensure_daily_partitions(1)");
    expect((await partitionsOn(pool, d4)).with).toBe(0);
  });

  it("refuses a start date in the future and a count past 400, naming the bound", async () => {
    const future = await cli(["partitions", "ensure", "--from", "2999-01-01"], { DATABASE_URL: urlOf(CLONE) });
    expect(future.code).not.toBe(0);
    expect(future.out).toMatch(/days_back must be 0\.\.400/);
    await expect(pool.query("select ensure_daily_partitions(1, 401)")).rejects.toThrow(/days_back must be 0\.\.400/);
    await expect(pool.query("select ensure_daily_partitions(401, 0)")).rejects.toThrow(/days_ahead must be 0\.\.400/);
    await expect(pool.query("select ensure_daily_partitions(1, null)")).rejects.toThrow(/days_back must be 0\.\.400/);
  });
});

/** One transaction per case, rolled back: nothing is left. */
async function inTx(fn: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await fn(c);
  } finally {
    await c.query("rollback");
    c.release();
  }
}

/** A scratch schema first on the search_path, with `daily` tables keyed on observed_at, a BRIN on each, and optionally a stray range table. */
async function scratch(c: pg.ClientBase, o: { daily?: number; stray?: boolean; local?: boolean } = {}): Promise<string> {
  const floor = (await c.query<{ n: number }>("select min_daily_tables as n from public.partition_settings where singleton")).rows[0]?.n ?? 0;
  const name = `zz_partwin_${randomBytes(4).toString("hex")}`;
  await c.query(`create schema ${name}`);
  await c.query(`set ${o.local === false ? "" : "local "}search_path = ${name}, public`);
  for (let i = 0; i < (o.daily ?? floor); i++) {
    await c.query(`create table t${String(i)} (observed_at timestamptz not null, note text) partition by range (observed_at)`);
    await c.query(`create index t${String(i)}_brin on t${String(i)} using brin (observed_at)`);
  }
  if (o.stray === true) await c.query("create table stray_ticks (feed_ts timestamptz not null, observed_at timestamptz not null) partition by range (feed_ts)");
  return name;
}

const days = async (c: pg.ClientBase, parent: string): Promise<string[]> =>
  (await c.query<{ d: string }>(`select regexp_replace(c.relname, '^.*_', '') as d from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = $1::regclass order by 1`, [parent])).rows.map((x) => x.d);
const window = async (c: pg.ClientBase, from: number, to: number): Promise<string[]> =>
  (await c.query<{ d: string }>("select to_char(current_date + i, 'YYYYMMDD') as d from generate_series($1::int, $2::int) i order by 1", [from, to])).rows.map((x) => x.d);

describe("5 — the partition machinery, on a scratch schema", () => {
  it("builds three days behind and days_ahead in front, or days_back behind with the two-argument form, and a row stamped in that window is accepted", async () => {
    await inTx(async (c) => {
      await scratch(c);
      await c.query("select ensure_daily_partitions(2)");
      expect(await days(c, "t0")).toEqual(await window(c, -3, 2));
      await c.query("select ensure_daily_partitions(0, 10)");
      expect(await days(c, "t0")).toEqual(await window(c, -10, 2));
      await c.query("insert into t0 (observed_at, note) values (now() - interval '9 days', 'nine days ago'), (now() - interval '1 second', 'now')");
      expect((await c.query<{ n: number }>("select count(*)::int as n from t0")).rows[0]?.n).toBe(2);
    });
  });

  it("refuses a range-partitioned table outside the daily schedule before creating anything", async () => {
    await inTx(async (c) => {
      await scratch(c, { stray: true });
      await c.query("savepoint s");
      await expect(c.query("select ensure_daily_partitions(1, 5)")).rejects.toThrow(/outside the daily schedule in schema .*stray_ticks partitioned by RANGE \(feed_ts\)/);
      await c.query("rollback to savepoint s");
      expect(await days(c, "t0")).toEqual([]);
    });
  });

  it("refuses fewer tables on the schedule than partition_settings' floor, a floor raised above them, and a missing floor row", async () => {
    await inTx(async (c) => {
      const floor = (await c.query<{ n: number }>("select min_daily_tables as n from public.partition_settings where singleton")).rows[0]?.n ?? 0;
      await scratch(c, { daily: floor - 1 });
      await c.query("savepoint s");
      await expect(c.query("select ensure_daily_partitions(1, 3)")).rejects.toThrow(new RegExp(`${String(floor - 1)} range-partitioned table\\(s\\) keyed on observed_at .*expected at least ${String(floor)}`));
      await c.query("rollback to savepoint s");
      await c.query(`create table t${String(floor - 1)} (observed_at timestamptz not null) partition by range (observed_at)`);
      await c.query("select ensure_daily_partitions(0, 0)");
      await c.query("update public.partition_settings set min_daily_tables = min_daily_tables + 1");
      await c.query("savepoint s2");
      await expect(c.query("select ensure_daily_partitions(0, 0)")).rejects.toThrow(/expected at least/);
      await c.query("rollback to savepoint s2");
      await c.query("delete from public.partition_settings");
      await expect(c.query("select ensure_daily_partitions(0, 0)")).rejects.toThrow(/no row in partition_settings/);
    });
  });

  it("each partition it makes is attached, carries the parent's columns and constraints, and its BRIN index is set to autosummarize — a second run alters nothing", async () => {
    await inTx(async (c) => {
      await scratch(c);
      await c.query("select ensure_daily_partitions(1, 1)");
      const parts = await c.query<{ rel: string; bound: string; auto: boolean }>(
        `select c.relname as rel, pg_get_expr(c.relpartbound, c.oid) as bound,
                coalesce((select bool_and(coalesce(ic.reloptions, '{}') @> '{autosummarize=on}') from pg_index x join pg_class ic on ic.oid = x.indexrelid join pg_am a on a.oid = ic.relam where x.indrelid = c.oid and a.amname = 'brin'), false) as auto
           from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 't0'::regclass order by 1`,
      );
      expect(parts.rows).toHaveLength(3);
      for (const p of parts.rows) {
        expect(p.bound).toMatch(/^FOR VALUES FROM \('.+'\) TO \('.+'\)$/);
        expect(p.auto, p.rel).toBe(true);
      }
      const cols = await c.query<{ a: string }>("select string_agg(attname || ':' || attnotnull, ',' order by attnum) as a from pg_attribute where attrelid = $1::regclass and attnum > 0", [parts.rows[0]?.rel ?? ""]);
      expect(cols.rows[0]?.a).toBe("observed_at:true,note:false");
      const oids = await c.query<{ o: string }>("select string_agg(i.inhrelid::text, ',' order by i.inhrelid) as o from pg_inherits i where i.inhparent = 't0'::regclass");
      await c.query("select ensure_daily_partitions(1, 1)");
      expect((await c.query<{ o: string }>("select string_agg(i.inhrelid::text, ',' order by i.inhrelid) as o from pg_inherits i where i.inhparent = 't0'::regclass")).rows[0]?.o).toBe(oids.rows[0]?.o);
    });
  });

  it("attaches a new day while another session reads the parent: the run completes inside a short lock_timeout (ATTACH, not CREATE … PARTITION OF)", async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    let name = "";
    try {
      name = await scratch(a, { local: false });
      await a.query("select ensure_daily_partitions(0, 0)");
      await b.query("begin");
      await b.query(`select count(*) from ${name}.t0`);
      // b holds ACCESS SHARE on t0 until it ends; `partition of` would need ACCESS EXCLUSIVE and time out.
      await a.query("set lock_timeout = '2s'");
      await a.query("select ensure_daily_partitions(0, 2)");
      expect(await days(a, `${name}.t0`)).toEqual(await window(a, -2, 0));
    } finally {
      await b.query("rollback").catch(() => undefined);
      b.release();
      if (name !== "") await a.query(`drop schema ${name} cascade`);
      await a.query("reset search_path; reset lock_timeout");
      a.release();
    }
  });
});
