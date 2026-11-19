/**
 * 0319, 0320 and 0321: the three changes production was given by hand on
 * 2026-11-19, built for real by the migrations, on both paths a database takes:
 *
 *   1  a clean server: an empty database migrated from the first file holds
 *      the GiST index on autobahn_events ((geom)::geometry), on the parent and
 *      on every day partition, valid and attached; a partition
 *      ensure_daily_partitions makes later gets it too; road_events.payload
 *      compressed with lz4; the owner's and the readers' memory settings in
 *      pg_db_role_setting at their new values; the box read planned through
 *      the index;
 *   2  production's history: a database migrated to 0.3.4's head (0318, its
 *      role settings file), then given the hand changes as production got
 *      them (production's names; one partition's build failed and left an
 *      INVALID index, one partition's index built but not attached), then
 *      migrated to head: it ends in the schema of path 1, the hand-built
 *      indexes adopted, none built twice;
 *   3  a run again over either is a no-op, and a VALID matching partition
 *      index under another name is attached, not duplicated.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { DatabaseService } from "../src/service.js";
import { endPool } from "./domain-db.js";
import { REPO } from "./helpers.js";
import { migratedSuite, reapply } from "./no-transaction-index.js";
import { settingStatements } from "./role-settings.js";

const url = process.env["TEST_DATABASE_URL"];
const required = process.env["VF_REQUIRE_DB"] === "1";

if (url === undefined && required) {
  describe("0319-0321 hand changes of 2026-11-19", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the hand-changes test did not run");
    });
  });
}

const NEW = ["0319_autobahn_events_geom_gist.sql", "0320_road_events_payload_lz4.sql", "0321_role_memory_k3s.sql"];
const PARENT_DEF = "CREATE INDEX autobahn_events_geom_gist ON ONLY public.autobahn_events USING gist (((geom)::geometry))";
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

type Q = pg.Pool | pg.PoolClient;

/** Every gist index on ((geom)::geometry) of autobahn_events and its partitions, with the parent index it is attached to. */
type Ix = { tbl: string; ix: string; def: string; valid: boolean; attached_to: string | null; oid: number };
const geomIndexes = async (q: Q): Promise<Ix[]> =>
  (
    await q.query<Ix>(
      `select t.relname as tbl, i.relname as ix, pg_get_indexdef(i.oid) as def, x.indisvalid as valid,
              (select pi.relname from pg_inherits a join pg_class pi on pi.oid = a.inhparent where a.inhrelid = i.oid) as attached_to,
              i.oid::int as oid
         from pg_class t
         join pg_index x on x.indrelid = t.oid
         join pg_class i on i.oid = x.indexrelid
        where (t.oid = 'public.autobahn_events'::regclass
               or t.oid in (select inhrelid from pg_inherits where inhparent = 'public.autobahn_events'::regclass))
          and split_part(pg_get_indexdef(i.oid), ' USING ', 2) = 'gist (((geom)::geometry))'
        order by t.relname, i.relname`,
    )
  ).rows;

const partitionsOf = async (q: Q): Promise<string[]> =>
  (await q.query<{ p: string }>("select c.relname as p from pg_inherits h join pg_class c on c.oid = h.inhrelid where h.inhparent = 'public.autobahn_events'::regclass order by 1")).rows.map(
    (r) => r.p,
  );

const compression = async (q: Q): Promise<string> =>
  (await q.query<{ c: string }>("select attcompression::text as c from pg_attribute where attrelid = 'public.road_events'::regclass and attname = 'payload'")).rows[0]?.c ?? "?";

/** pg_db_role_setting of the current database: role → sorted name=value; the connecting role is `owner`. */
const roleSettings = async (q: Q): Promise<Record<string, string[]>> => {
  const r = await q.query<{ role: string; s: string[] }>(
    `select case when r.rolname = current_user then 'owner' else r.rolname end as role, array(select x from unnest(d.setconfig) x order by x) as s
       from pg_db_role_setting d join pg_roles r on r.oid = d.setrole
      where d.setdatabase = (select oid from pg_database where datname = current_database()) order by 1`,
  );
  return Object.fromEntries(r.rows.map((x) => [x.role, x.s]));
};

const memory = (s: Record<string, string[]>): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(s)
      .filter(([role]) => ["owner", "viafrei_digest", "viafrei_mcp"].includes(role))
      .map(([role, v]) => [role, v.filter((x) => /^(work_mem|hash_mem_multiplier|maintenance_work_mem|effective_cache_size)=/.test(x))]),
  );

/** The schema these files decide, in a shape two databases can be compared in (a partition index named as either path names it). */
const catalogue = async (q: Q): Promise<unknown> => ({
  indexes: (await geomIndexes(q)).map(({ tbl, ix, def, valid, attached_to }) => ({
    tbl,
    ix: ix.replace(/_geom_(gist|idx)$/, "_geom_*"),
    def: def.replace(/ (\S+?)_geom_(gist|idx) ON /, " $1_geom_* ON "),
    valid,
    attached_to,
  })),
  compression: await compression(q),
  roles: await roleSettings(q),
});

describe.skipIf(url === undefined)("0319-0321 hand changes of 2026-11-19", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "hand1119");

  // The clean server's schema as migrate built it, before the tests below change anything.
  let clean: unknown;

  describe("1 — a clean server: an empty database migrated from the first file", () => {
    beforeAll(async () => {
      clean = await catalogue(t.pool);
    });

    it("holds the parent's GiST index, valid, and every day partition's, valid and attached to it", async () => {
      const ix = await geomIndexes(t.pool);
      const parts = await partitionsOf(t.pool);
      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(ix.filter((x) => x.tbl === "autobahn_events").map(({ ix: n, def, valid, attached_to }) => ({ n, def, valid, attached_to }))).toEqual([
        { n: "autobahn_events_geom_gist", def: PARENT_DEF, valid: true, attached_to: null },
      ]);
      const children = ix.filter((x) => x.tbl !== "autobahn_events");
      expect(children.map((x) => x.tbl)).toEqual(parts);
      for (const c of children) {
        expect({ valid: c.valid, attached_to: c.attached_to }).toEqual({ valid: true, attached_to: "autobahn_events_geom_gist" });
        expect(c.def).toBe(`CREATE INDEX ${c.ix} ON public.${c.tbl} USING gist (((geom)::geometry))`);
      }
    });

    it("gives a day partition ensure_daily_partitions makes later the index, attached, the parent's still valid", async () => {
      await t.planted(async (c) => {
        const before = new Set(await partitionsOf(c));
        const ahead = (
          await c.query<{ n: number }>(
            `select (max(substring(c.relname from '(\\d{8})$')::date) - current_date + 1)::int as n
               from pg_inherits h join pg_class c on c.oid = h.inhrelid where h.inhparent = 'public.autobahn_events'::regclass`,
          )
        ).rows[0]?.n;
        expect(ahead).toBeGreaterThan(0);
        await c.query("select public.ensure_daily_partitions($1, 3)", [ahead]);
        const fresh = (await geomIndexes(c)).filter((x) => x.tbl !== "autobahn_events" && !before.has(x.tbl));
        expect(fresh).toHaveLength(1);
        expect(fresh.map(({ valid, attached_to }) => ({ valid, attached_to }))).toEqual([{ valid: true, attached_to: "autobahn_events_geom_gist" }]);
        expect((await geomIndexes(c)).find((x) => x.tbl === "autobahn_events")?.valid).toBe(true);
      });
    });

    it("plans the road reads' box test on the newest ticks through a partition's GiST index", async () => {
      await t.planted(async (c) => {
        await c.query(
          `insert into public.autobahn_events (observed_at, road, kind, ext_id, geom)
           select now() - (g % 1800) * interval '1 second', 'A' || (g % 9), 'roadworks', 'e' || g,
                  st_setsrid(st_makepoint(6 + (g % 900) * 0.01, 47.5 + (g % 700) * 0.01), 4326)::geography
             from generate_series(1, 30000) g`,
        );
        await c.query("analyze public.autobahn_events");
        const p = (
          await c.query<{ "QUERY PLAN": string }>(
            `explain select w.ext_id from public.autobahn_events w
              where w.observed_at >= now() - interval '30 minutes' and w.geom::geometry && st_makeenvelope(13.3, 52.4, 13.5, 52.6, 4326)`,
          )
        ).rows
          .map((x) => x["QUERY PLAN"])
          .join("\n");
        expect(p).toMatch(/Index Scan using autobahn_events_\d{8}_geom_(gist|idx)|Bitmap Index Scan on autobahn_events_\d{8}_geom_(gist|idx)/);
      });
    });

    it("compresses road_events.payload with lz4", async () => {
      expect(await compression(t.pool)).toBe("l");
    });

    it("holds the owner's and both readers' new memory settings in this database", async () => {
      expect(memory(await roleSettings(t.pool))).toEqual({
        owner: ["effective_cache_size=40GB", "hash_mem_multiplier=2", "maintenance_work_mem=256MB", "work_mem=64MB"],
        viafrei_digest: ["effective_cache_size=40GB", "hash_mem_multiplier=2", "work_mem=64MB"],
        viafrei_mcp: ["effective_cache_size=40GB", "hash_mem_multiplier=2", "work_mem=64MB"],
      });
    });

    it("is a no-op run again, each file alone with its ledger row deleted, and as a whole", async () => {
      const s = service();
      const before = { ix: await geomIndexes(t.pool), cat: await catalogue(t.pool) };
      for (const f of NEW.slice(0, 1)) await reapply(t, s, f);
      for (const f of NEW.slice(1)) {
        const version = Number(f.slice(0, 4));
        await t.pool.query("delete from schema_migrations where version = $1", [version]);
        const run = await s.migrate("cli");
        expect(run.ok, run.lines.join("\n")).toBe(true);
        expect(run.lines.filter((l) => l.startsWith("applying"))).toEqual([`applying ${f}`]);
      }
      const again = await s.migrate("cli");
      expect(again.lines.join("\n")).toMatch(/✓ 0 migration\(s\) applied/);
      expect({ ix: await geomIndexes(t.pool), cat: await catalogue(t.pool) }).toEqual(before);
    });

    it("attaches a VALID matching partition index of another name rather than build a second, and rebuilds an INVALID one", async () => {
      const s = service();
      const [p1, p2] = await partitionsOf(t.pool);
      if (p1 === undefined || p2 === undefined) throw new Error("too few autobahn_events partitions");
      // Back to a parent with no partition attached: dropping the parent's index drops every attached one with it.
      await t.pool.query("drop index public.autobahn_events_geom_gist");
      await t.pool.query("create index autobahn_events_geom_gist on only public.autobahn_events using gist ((geom::geometry))");
      await t.pool.query(`create index ${p1}_hand on public.${p1} using gist ((geom::geometry))`);
      await t.pool.query(`create index ${p2}_geom_gist on public.${p2} using gist ((geom::geometry))`);
      await t.pool.query(`update pg_index set indisvalid = false where indexrelid = 'public.${p2}_geom_gist'::regclass`);
      const adopted = (await geomIndexes(t.pool)).find((x) => x.ix === `${p1}_hand`)?.oid;
      const failed = (await geomIndexes(t.pool)).find((x) => x.ix === `${p2}_geom_gist`)?.oid;
      await reapply(t, s, NEW[0] ?? "");
      const after = await geomIndexes(t.pool);
      expect(after.filter((x) => x.tbl === p1).map(({ ix, valid, attached_to, oid }) => ({ ix, valid, attached_to, oid }))).toEqual([
        { ix: `${p1}_hand`, valid: true, attached_to: "autobahn_events_geom_gist", oid: adopted },
      ]);
      const rebuilt = after.filter((x) => x.tbl === p2);
      expect(rebuilt.map(({ ix, valid, attached_to }) => ({ ix, valid, attached_to }))).toEqual([{ ix: `${p2}_geom_idx`, valid: true, attached_to: "autobahn_events_geom_gist" }]);
      expect(rebuilt[0]?.oid).not.toBe(failed);
      for (const x of after) expect({ tbl: x.tbl, valid: x.valid }).toEqual({ tbl: x.tbl, valid: true });
      expect(after.filter((x) => x.tbl !== "autobahn_events").map((x) => x.tbl)).toEqual(await partitionsOf(t.pool));
    });
  });

  describe("2 — production's history: 0.3.4's head, the hand changes as production got them, then head", () => {
    const name = `test_vfdb_hist1119_${String(process.pid)}`;
    const admin = new pg.Pool({ connectionString: url ?? "postgresql://x@127.0.0.1/x", max: 1 });
    const own = new URL(url ?? "postgresql://x@127.0.0.1/x");
    own.pathname = `/${name}`;
    const dir = mkdtempSync(join(tmpdir(), "vfdb-hist1119-"));
    let pool: pg.Pool | undefined;
    let migrated: Awaited<ReturnType<DatabaseService["migrate"]>> | undefined;
    let built: { parts: string[]; failed: string; loose: string; looseOid: number } | undefined;

    const svc = (env: Record<string, string>): DatabaseService =>
      new DatabaseService({ config: loadConfig({ DATABASE_URL: own.toString(), DB_MIGRATE_LOCK_PAUSE_S: "1", ...env }, "serve"), log: quiet });

    beforeAll(async () => {
      // 0.3.4's schema: the migrations up to 0318 and the role settings file without 0321's statements.
      const mig = join(dir, "migrations");
      const roles = join(dir, "roles");
      mkdirSync(mig);
      mkdirSync(roles);
      for (const f of readdirSync(join(REPO, "db", "migrations")).filter((n) => /^\d{4}_.*\.sql$/.test(n) && Number(n.slice(0, 4)) <= 318)) {
        symlinkSync(join(REPO, "db", "migrations", f), join(mig, f));
      }
      const later = new Set(settingStatements(readFileSync(join(REPO, "db", "migrations", "0321_role_memory_k3s.sql"), "utf8")));
      writeFileSync(join(roles, "settings.sql"), readFileSync(join(REPO, "db", "roles", "settings.sql"), "utf8").split("\n").filter((l) => !later.has(l)).join("\n"));

      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.query(`create database ${name}`);
      const old = svc({ VF_DB_MIGRATIONS_DIR: mig, VF_DB_ROLES_SQL_DIR: roles });
      try {
        await old.boot(1_000);
      } finally {
        await endPool(old.pool, () => old.close());
      }
      pool = new pg.Pool({ connectionString: own.toString(), max: 2 });
      expect((await pool.query<{ v: number }>("select max(version)::int as v from schema_migrations")).rows[0]?.v).toBe(318);
      expect(memory(await roleSettings(pool))["owner"]).toEqual(["hash_mem_multiplier=1.0", "maintenance_work_mem=64MB", "work_mem=16MB"]);
      expect(await compression(pool)).toBe("");

      // The hand changes, with production's statements and names: the parent ON ONLY, each partition's index
      // built and attached — one build failed (INVALID, never attached), one built and not attached yet.
      const parts = await partitionsOf(pool);
      const [failed, loose] = parts;
      if (failed === undefined || loose === undefined) throw new Error("too few autobahn_events partitions");
      await pool.query("create index if not exists autobahn_events_geom_gist on only public.autobahn_events using gist ((geom::geometry))");
      for (const p of parts) {
        await pool.query(`create index concurrently if not exists ${p}_geom_gist on public.${p} using gist ((geom::geometry))`);
        if (p !== failed && p !== loose) await pool.query(`alter index public.autobahn_events_geom_gist attach partition public.${p}_geom_gist`);
      }
      await pool.query(`update pg_index set indisvalid = false where indexrelid = 'public.${failed}_geom_gist'::regclass`);
      await pool.query("set lock_timeout = '5s'");
      await pool.query("alter table public.road_events alter column payload set compression lz4");
      for (const [role, settings] of [
        ["current_user", ["work_mem = '64MB'", "hash_mem_multiplier = 2", "effective_cache_size = '40GB'", "maintenance_work_mem = '256MB'"]],
        ["viafrei_digest", ["work_mem = '64MB'", "hash_mem_multiplier = 2", "effective_cache_size = '40GB'"]],
        ["viafrei_mcp", ["work_mem = '64MB'", "hash_mem_multiplier = 2", "effective_cache_size = '40GB'"]],
      ] as const) {
        for (const s of settings) await pool.query(`alter role ${role} in database ${name} set ${s}`);
      }
      const looseOid = (await pool.query<{ oid: number }>(`select 'public.${loose}_geom_gist'::regclass::oid::int as oid`)).rows[0]?.oid ?? 0;
      built = { parts, failed, loose, looseOid };

      const head = svc({});
      try {
        migrated = await head.migrate("cli");
      } finally {
        await endPool(head.pool, () => head.close());
      }
    }, 900_000);

    afterAll(async () => {
      if (pool !== undefined) await endPool(pool);
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
      rmSync(dir, { recursive: true, force: true });
    });

    it("applies 0319, 0320 and 0321 over the hand-built state without an error", () => {
      expect(migrated?.ok, migrated?.lines.join("\n")).toBe(true);
      expect(migrated?.lines.filter((l) => l.startsWith("applying")).map((l) => l.split(" ")[1])).toEqual(NEW);
    });

    it("adopts the hand-built indexes under production's names, attaches the loose one, rebuilds the INVALID one, builds none twice", async () => {
      if (pool === undefined || built === undefined) throw new Error("no history database");
      const { failed, loose } = built;
      const ix = await geomIndexes(pool);
      // One index per table: the INVALID one rebuilt under the server's name, every other kept under production's.
      expect(ix.map(({ tbl, ix: n, valid, attached_to }) => ({ tbl, n, valid, attached_to }))).toEqual([
        { tbl: "autobahn_events", n: "autobahn_events_geom_gist", valid: true, attached_to: null },
        ...built.parts.map((p) => ({ tbl: p, n: p === failed ? `${p}_geom_idx` : `${p}_geom_gist`, valid: true, attached_to: "autobahn_events_geom_gist" })),
      ]);
      expect(ix.find((x) => x.tbl === loose)?.oid).toBe(built.looseOid);
    });

    it("ends in the schema the clean server's migration builds: indexes, attachments, compression and role settings", async () => {
      if (pool === undefined) throw new Error("no history database");
      expect(clean).toBeDefined();
      expect(await catalogue(pool)).toEqual(clean);
    });

    it("runs again as a no-op", async () => {
      if (pool === undefined) throw new Error("no history database");
      const before = { ix: await geomIndexes(pool), cat: await catalogue(pool) };
      const head = svc({});
      try {
        const run = await head.migrate("cli");
        expect(run.ok).toBe(true);
        expect(run.lines.join("\n")).toMatch(/✓ 0 migration\(s\) applied/);
      } finally {
        await endPool(head.pool, () => head.close());
      }
      expect({ ix: await geomIndexes(pool), cat: await catalogue(pool) }).toEqual(before);
    });
  });
});
