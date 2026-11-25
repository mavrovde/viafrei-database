/**
 * The feed_ts indexes of 0318 (vrn_transit_delays) and 0352
 * (vbb_transit_delays), each: the parent's index present,
 * valid and of the definition production was given by hand first, every day
 * partition's index attached; the digest's freshness probe a backward walk of
 * it under the generic plan, the one the plan cache keeps; a day partition
 * ensure_daily_partitions makes later born with it; the file a no-op over a
 * database that already holds it (production's case), while a half-built state
 * (some partitions without it, an INVALID leftover) is finished. 0352 came
 * once the digest's VBB probe carried the feed_ts bound (see its header).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { migratedSuite, reapply } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];
const required = process.env["VF_REQUIRE_DB"] === "1";

if (url === undefined && required) {
  describe("0318/0352 transit delays feed_ts", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the feed_ts index test did not run");
    });
  });
}

const TABLES = ["vbb_transit_delays", "vrn_transit_delays"] as const;
/** The migration that gives each table its index. */
const FILES = { vbb_transit_delays: "0352_vbb_transit_delays_feed_ts.sql", vrn_transit_delays: "0318_vrn_transit_delays_feed_ts.sql" } as const;
const def = (t: string): string => `CREATE INDEX ${t}_feed_ts ON ONLY public.${t} USING btree (feed_ts)`;

describe.skipIf(url === undefined)("0318/0352 transit delays feed_ts", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "feedts");

  type Parent = { name: string; def: string; valid: boolean; oid: number };
  const parents = async (q: pg.Pool | pg.PoolClient = t.pool): Promise<Parent[]> =>
    (
      await q.query<Parent>(
        `select c.relname as name, pg_get_indexdef(i.indexrelid) as def, i.indisvalid as valid, i.indexrelid::int as oid
           from pg_index i join pg_class c on c.oid = i.indexrelid
          where c.relnamespace = 'public'::regnamespace and c.relname = any($1) order by c.relname`,
        [TABLES.map((x) => `${x}_feed_ts`)],
      )
    ).rows;

  /** Every partition of the two tables, with the index of it attached to its parent's feed_ts index (null if none). */
  type Part = { part: string; ix: string | null; ixdef: string | null; valid: boolean | null; oid: number | null };
  const partitions = async (q: pg.Pool | pg.PoolClient = t.pool): Promise<Part[]> =>
    (
      await q.query<Part>(
        `select p.relname as part, ic.relname as ix, pg_get_indexdef(ic.oid) as ixdef, x.indisvalid as valid, ic.oid::int as oid
           from unnest($1::text[]) tb
           join pg_inherits h on h.inhparent = ('public.' || tb)::regclass
           join pg_class p on p.oid = h.inhrelid
           left join lateral (
             select x.indexrelid, x.indisvalid from pg_index x join pg_inherits a on a.inhrelid = x.indexrelid
              where x.indrelid = p.oid and a.inhparent = to_regclass('public.' || tb || '_feed_ts')) x on true
           left join pg_class ic on ic.oid = x.indexrelid
          order by p.relname`,
        [TABLES],
      )
    ).rows;

  it("has the parent's index, valid, with the definition production was given, each partition's attached", async () => {
    expect((await parents()).map(({ name, def: d, valid }) => ({ name, def: d, valid }))).toEqual(TABLES.map((x) => ({ name: `${x}_feed_ts`, def: def(x), valid: true })));
    const parts = await partitions();
    expect(parts.length).toBeGreaterThanOrEqual(10);
    for (const p of parts) {
      expect({ ix: p.ix, ixdef: p.ixdef, valid: p.valid }).toEqual({ ix: `${p.part}_feed_ts_idx`, ixdef: `CREATE INDEX ${p.part}_feed_ts_idx ON public.${p.part} USING btree (feed_ts)`, valid: true });
    }
  });

  const plan = async (c: pg.PoolClient, sql: string): Promise<string> =>
    (await c.query<{ "QUERY PLAN": string }>(`explain ${sql}`)).rows.map((x) => x["QUERY PLAN"]).join("\n");

  const seed = async (c: pg.PoolClient, table: string): Promise<void> => {
    // Three days of ticks, one every two seconds: tens of thousands of rows in the partitions the bound keeps and prunes.
    await c.query(
      `insert into public.${table} (observed_at, feed_ts, trip_id, stop_id, delay_s)
       select now() - g * interval '2 seconds', now() - g * interval '2 seconds' - interval '20 seconds', 't' || (g % 900), 's' || (g % 300), g % 600
         from generate_series(0, 3 * 43200) g`,
    );
    await c.query(`analyze public.${table}`);
  };

  // The probe as the digest sends it, with the bound as a parameter.
  const PROBES = {
    vbb_transit_delays: "select max(feed_ts) as newest from public.vbb_transit_delays_live where observed_at >= $1 and feed_ts >= $1",
    vrn_transit_delays: "select max(feed_ts) as newest from public.vrn_transit_delays_live where observed_at >= $1 and feed_ts >= $1",
  } as const;

  for (const table of TABLES) {
    it(`walks ${table}_feed_ts backward for the freshness probe, generic plan and custom, and the plan cache keeps the generic one`, async () => {
      await t.planted(async (c) => {
        await seed(c, table);
        await c.query(`prepare probe (timestamptz) as ${PROBES[table]}`);
        await c.query("set local plan_cache_mode = force_generic_plan");
        const generic = await plan(c, "execute probe (now() - interval '15 minutes')");
        expect(generic).toMatch(new RegExp(`Index Only Scan Backward using ${table}_\\d{8}_feed_ts_idx|Index Scan Backward using ${table}_\\d{8}_feed_ts_idx`));
        expect(generic).toMatch(/\$1/);
        expect(generic).not.toMatch(/Seq Scan|Bitmap|brin/i);
        await c.query("set local plan_cache_mode = force_custom_plan");
        const custom = await plan(c, "execute probe (now() - interval '15 minutes')");
        expect(custom).toMatch(new RegExp(`Index (Only )?Scan Backward using ${table}_\\d{8}_feed_ts_idx`));
        expect(custom).not.toMatch(/Seq Scan|Bitmap|brin/i);
        // auto: after its five custom plans the cache compares and keeps the generic one (a generic plan shows $1).
        await c.query("set local plan_cache_mode = auto");
        for (let i = 0; i < 6; i += 1) await c.query("execute probe (now() - interval '15 minutes')");
        expect(await plan(c, "execute probe (now() - interval '15 minutes')")).toMatch(/\$1/);
        await c.query("deallocate probe");
      });
    });
  }

  it("gives a day partition ensure_daily_partitions makes later the index, attached, the parent's index still valid", async () => {
    await t.planted(async (c) => {
      const before = new Set((await partitions(c)).map((p) => p.part));
      const ahead = (await c.query<{ n: number }>(
        `select (max(substring(c.relname from '(\\d{8})$')::date) - current_date + 1)::int as n
           from pg_inherits h join pg_class c on c.oid = h.inhrelid where h.inhparent = any($1::regclass[])`,
        [TABLES.map((x) => `public.${x}`)],
      )).rows[0]?.n;
      expect(ahead).toBeGreaterThan(0);
      await c.query("select public.ensure_daily_partitions($1, 3)", [ahead]);
      const fresh = (await partitions(c)).filter((p) => !before.has(p.part));
      expect(fresh.map((p) => p.part.replace(/_\d{8}$/, "")).sort()).toEqual([...TABLES]);
      for (const p of fresh) expect({ ix: p.ix, valid: p.valid }).toEqual({ ix: `${p.part}_feed_ts_idx`, valid: true });
      expect((await parents(c)).map((p) => p.valid)).toEqual(TABLES.map(() => true));
    });
  });

  for (const table of TABLES) {
    it(`${FILES[table].slice(0, 4)} is a no-op over the index production already holds, and finishes a half-built state with an INVALID leftover`, async () => {
      const s = service();
      const before = { parents: await parents(), parts: await partitions() };
      // Production's case: the index made by hand with this file's statements, the ledger without the file's row.
      await reapply(t, s, FILES[table]);
      expect({ parents: await parents(), parts: await partitions() }).toEqual(before);

      // A hand build interrupted: the parent's index ON ONLY, a few partitions built, one of them a failed (INVALID) build.
      await t.pool.query(`drop index public.${table}_feed_ts`);
      await t.pool.query(`create index ${table}_feed_ts on only public.${table} (feed_ts)`);
      const [built, failed] = before.parts.map((p) => p.part).filter((p) => p.startsWith(`${table}_`));
      if (built === undefined || failed === undefined) throw new Error(`too few ${table} partitions`);
      for (const p of [built, failed]) await t.pool.query(`create index ${p}_feed_ts_idx on public.${p} (feed_ts)`);
      await t.pool.query(`alter index public.${table}_feed_ts attach partition public.${built}_feed_ts_idx`);
      await t.pool.query(`update pg_index set indisvalid = false where indexrelid = 'public.${failed}_feed_ts_idx'::regclass`);
      const failedOid = (await t.pool.query<{ oid: number }>(`select 'public.${failed}_feed_ts_idx'::regclass::oid::int as oid`)).rows[0]?.oid;
      expect((await parents()).find((p) => p.name === `${table}_feed_ts`)?.valid).toBe(false);

      await reapply(t, s, FILES[table]);
      expect((await parents()).map(({ name, def: d, valid }) => ({ name, def: d, valid }))).toEqual(before.parents.map(({ name, def: d, valid }) => ({ name, def: d, valid })));
      const after = await partitions();
      expect(after.map(({ part, ix, ixdef, valid }) => ({ part, ix, ixdef, valid }))).toEqual(before.parts.map(({ part, ix, ixdef, valid }) => ({ part, ix, ixdef, valid })));
      expect(after.find((p) => p.part === failed)?.oid).not.toBe(failedOid);
    });
  }
});
