/**
 * 0339: every SECURITY DEFINER function and every trigger function runs under a
 * search_path of its own, with pg_temp listed.
 *
 *  - the catalogue: every such function of the repository's schemas (an
 *    extension's own excluded) carries `search_path=` in proconfig, and the
 *    path names pg_temp (unnamed, it is searched first);
 *  - an archived autobahn_events day comes back: pg_dump of the partition,
 *    the partition dropped, pg_restore of its pre-data and data sections
 *    (the archive's own restore, which runs under search_path ''), and the
 *    rows are back with their land_code, the trigger fired by the COPY;
 *  - road_events, which is not partitioned: an insert and an update of geom
 *    under search_path '' fire road_events_land and store the Land;
 *  - refresh_event_land runs under search_path '' too.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * pg_dump and pg_restore come from PATH, the client package psql comes from.
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { migratedSuite } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0339 pinned search_path", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0339 test did not run");
    });
  });
}

type Run = { code: number; stdout: Buffer; stderr: string };

/** Runs a client binary, `input` on its stdin; never rejects (a missing binary is code 127). */
function run(bin: string, args: readonly string[], input?: Buffer): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", (e) => resolve({ code: 127, stdout: Buffer.alloc(0), stderr: `${bin} could not be started: ${e.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8") }));
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

/** The functions the rule covers: SECURITY DEFINER or returning trigger, in a schema of ours, not an extension's member. */
const COVERED = `select p.oid::regprocedure::text as fn, p.prosecdef as definer,
       (select c from unnest(p.proconfig) c where c like 'search_path=%') as path
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
   and (p.prosecdef or p.prorettype = 'pg_catalog.trigger'::regtype)
   and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
 order by 1`;

const GAZ = `insert into public.gazetteer_places (kind, name, name_norm, admin_code, geom, source_id, external_id) values
  ('city', 'S', 's', '08111000', public.st_setsrid(public.st_makepoint(9.18, 48.78), 4326)::public.geography, 'bkg_gvisys', 'g1'),
  ('city', 'K', 'k', '05315000', public.st_setsrid(public.st_makepoint(6.96, 50.94), 4326)::public.geography, 'bkg_gvisys', 'g3')`;

if (url !== undefined) {
  describe("0339 pinned search_path", () => {
    const { t } = migratedSuite(url, "m0339");
    const q = async <R extends object>(sql: string, params: unknown[] = []): Promise<R[]> => (await t.pool.query<R>(sql, params)).rows;

    it("pins a search_path naming pg_temp on every SECURITY DEFINER and every trigger function", async () => {
      const fns = await q<{ fn: string; definer: boolean; path: string | null }>(COVERED);
      // The rule has something to hold over: the two 0338 trigger functions and a definer are among them.
      expect(fns.map((f) => f.fn)).toEqual(expect.arrayContaining(["autobahn_events_fill_land()", "road_events_fill_land()", "contract_junction_land(geography)"]));
      expect(fns.filter((f) => f.definer).length).toBeGreaterThan(10);
      expect(fns.filter((f) => f.path === null).map((f) => f.fn)).toEqual([]);
      expect(fns.filter((f) => f.path !== null && !/^search_path=.*\bpg_temp\b/u.test(f.path)).map((f) => `${f.fn} ${String(f.path)}`)).toEqual([]);
    });

    it("restores an archived autobahn_events day, the COPY firing autobahn_events_land under search_path ''", async () => {
      await t.pool.query(GAZ);
      await t.pool.query("select public.ensure_daily_partitions(1)");
      const seeded = await q<{ part: string }>(
        `insert into public.autobahn_events (observed_at, road, kind, ext_id, title, source, geom)
         select now(), 'A8', 'roadworks', 'r' || i, 'A8 | X', 'autobahn', g::geometry::geography from unnest($1::text[]) with ordinality u(g, i)
         returning tableoid::regclass::text as part`,
        [["SRID=4326;POINT(9.2 48.79)", "SRID=4326;POINT(6.97 50.95)", null]],
      );
      const part = seeded[0]?.part ?? "";
      expect(part).toMatch(/^autobahn_events_\d{8}$/u);
      const before = await q<{ ext_id: string; land_code: string | null }>(`select ext_id, land_code from public.${part} order by ext_id`);
      expect(before).toEqual([{ ext_id: "r1", land_code: "08" }, { ext_id: "r2", land_code: "05" }, { ext_id: "r3", land_code: null }]);

      // The archive's dump: custom format, one partition, no owner, no privileges.
      const dump = await run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--table=public.${part}`, `--dbname=${t.url}`]);
      expect(dump.code, dump.stderr).toBe(0);
      await t.pool.query(`drop table public.${part}`);
      // The archive's restore: pre-data (the table and its ATTACH) and data (the COPY), stopping at the first error.
      const restore = await run("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", "--section=pre-data", "--section=data", `--dbname=${t.url}`], dump.stdout);
      expect(restore.stderr).not.toMatch(/does not exist/u);
      expect(restore.code, restore.stderr).toBe(0);
      expect(await q(`select ext_id, land_code from public.${part} order by ext_id`)).toEqual(before);
      expect(await q<{ attached: boolean }>("select exists (select 1 from pg_inherits where inhrelid = $1::regclass and inhparent = 'public.autobahn_events'::regclass) as attached", [part])).toEqual([{ attached: true }]);
    });

    it("stores road_events' Land on an insert and an update of geom under search_path '', and refresh_event_land runs there", async () => {
      const c = await t.pool.connect();
      try {
        await c.query("set search_path = ''");
        const ins = await c.query<{ id: string; land_code: string | null }>(
          `insert into public.road_events (feed_key, source_id, publication_id, version, payload, geom)
           values ('f', 's', 'sp1', 1, '{}'::jsonb, 'SRID=4326;POINT(9.2 48.79)'::public.geometry) returning id, land_code`,
        );
        expect(ins.rows[0]?.land_code).toBe("08");
        const upd = await c.query<{ land_code: string | null }>(
          "update public.road_events set geom = 'SRID=4326;POINT(6.97 50.95)'::public.geometry where id = $1 returning land_code",
          [ins.rows[0]?.id],
        );
        expect(upd.rows).toEqual([{ land_code: "05" }]);
        await c.query("update public.road_events set land_code = null where id = $1", [ins.rows[0]?.id]);
        await c.query("call public.refresh_event_land(10)");
        expect((await c.query("select land_code from public.road_events where id = $1", [ins.rows[0]?.id])).rows).toEqual([{ land_code: "05" }]);
      } finally {
        await c.query("reset search_path");
        c.release();
      }
    });
  });
}
