/**
 * 0328 and 0329: two more changes production was given by hand on 2026-11-22,
 * made the schema's:
 *
 *   0328  weather_warnings_area_live_de, weather_warnings_area_live without its
 *         English columns (no weather_warning_english() per row), readable by
 *         the digest;
 *   0329  every day partition of autobahn_events analysed after 1 % plus 2 000
 *         changed rows, through tick_partition_options(), which
 *         ensure_daily_partitions calls for each day it keeps.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { migratedSuite } from "./no-transaction-index.js";
import { insertRow } from "./seed-fill.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0328-0329 hand changes of 2026-11-22", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0328-0329 test did not run");
    });
  });
}

type Q = pg.Pool | pg.PoolClient;
const WANT = ["autovacuum_analyze_scale_factor=0.01", "autovacuum_analyze_threshold=2000"];
const T = (min: number): string => `now() - interval '30 minutes' + interval '${String(min)} minutes'`;

const columns = async (q: Q, view: string): Promise<string[]> =>
  (
    await q.query<{ c: string }>(
      "select attname as c from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum",
      [view],
    )
  ).rows.map((r) => r.c);

/** Each day partition of `parent` and its reloptions, by name. */
const partOptions = async (q: Q, parent: string): Promise<Record<string, string[]>> =>
  Object.fromEntries(
    (
      await q.query<{ n: string; o: string[] | null }>(
        "select c.relname as n, c.reloptions as o from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = $1::regclass order by 1",
        [parent],
      )
    ).rows.map((r) => [r.n, [...(r.o ?? [])].sort()]),
  );

describe.skipIf(url === undefined)("0328-0329 hand changes of 2026-11-22", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "hand1122e");

  const rerun = async (version: number): Promise<{ ok: boolean; text: string; applying: string[] }> => {
    await t.pool.query("delete from schema_migrations where version = $1", [version]);
    const run = await service().migrate("cli");
    return { ok: run.ok, text: run.lines.join("\n"), applying: run.lines.filter((l) => l.startsWith("applying")) };
  };

  it("weather_warnings_area_live_de has area_live's columns, in order, without the en_* ones", async () => {
    const all = await columns(t.pool, "public.weather_warnings_area_live");
    const de = await columns(t.pool, "public.weather_warnings_area_live_de");
    expect(all.filter((c) => c.startsWith("en_"))).toEqual(["en_headline", "en_description", "en_instruction", "en_content_sha256"]);
    expect(de).toEqual(all.filter((c) => !c.startsWith("en_")));
  });

  it("weather_warnings_area_live_de returns area_live's rows minus the English, and never calls weather_warning_english()", async () => {
    await t.planted(async (c) => {
      // 40 German warnings over two cells, every seventh deleted; an English twin for every odd one.
      const cell = (g: number): string => (g % 2 === 0 ? "105315000" : "109162000");
      for (let g = 1; g <= 40; g++) {
        await insertRow(c, "public.weather_warnings", {
          identifier: `'w${String(g)}'`, warncell_id: `'${cell(g)}'`, event: "'FROST'", level: String(1 + (g % 4)), headline: `'Kopf ${String(g)}'`,
          description: g % 3 === 0 ? "null" : `'Text ${String(g)}'`, instruction: g % 5 === 0 ? `'Rat ${String(g)}'` : "null",
          published_at: T(0), valid_from: T(0), valid_to: T(90), raw: `'{"properties":{"EC_II":"${String(30 + (g % 3))}"}}'`,
          deleted_at: g % 7 === 0 ? "now()" : "null",
          area_sha256: `repeat('a', 64)`, official_sha256: `encode(sha256('w${String(g)}'::bytea), 'hex')`,
        }, 1000 + g, "1");
        if (g % 2 === 1)
          await insertRow(c, "public.weather_warnings_en", {
            identifier: `'e${String(g)}'`, base_identifier: `'w${String(g)}'`, language: "'en'", headline: `'Head ${String(g)}'`,
            description: `'Text EN ${String(g)}'`, sent_at: T(0), valid_from: T(0), valid_to: T(90), warncell_ids: `'{${cell(g)}}'`,
            raw: `'{"eventCodes":{"II":"${String(30 + (g % 3))}"}}'`,
            content_sha256: `encode(sha256('e${String(g)}'::bytea), 'hex')`,
          }, 2000 + g, "1");
      }
      const cols = (await columns(c, "public.weather_warnings_area_live_de")).join(", ");
      const order = "order by identifier, warncell_id, valid_from";
      const de = (await c.query(`select * from public.weather_warnings_area_live_de ${order}`)).rows;
      const all = (await c.query(`select ${cols} from public.weather_warnings_area_live ${order}`)).rows;
      expect(de).toEqual(all);
      // the planting reaches what the twin must carry: deleted rows left out, some with English, some without
      expect(de.length).toBeGreaterThan(20);
      expect(de.length).toBeLessThan(40);
      const en = (await c.query<{ n: number }>("select count(en_headline)::int as n from public.weather_warnings_area_live")).rows[0]?.n;
      expect(en).toBeGreaterThan(0);
      expect(en).toBeLessThan(de.length);
      const plan = (await c.query<{ "QUERY PLAN": string }>("explain (verbose) select * from public.weather_warnings_area_live_de")).rows
        .map((r) => r["QUERY PLAN"])
        .join("\n");
      expect(plan).not.toMatch(/weather_warning_english/);
    });
  });

  it("weather_warnings_area_live_de is readable by the digest and by no other reader", async () => {
    const roles = (
      await t.pool.query<{ r: string }>(
        `select grantee as r from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'weather_warnings_area_live_de' and privilege_type = 'SELECT'
            and grantee <> current_user order by 1`,
      )
    ).rows.map((r) => r.r);
    expect(roles).toEqual(["viafrei_digest"]);
  });

  it("0328 adopts production's hand-made view (create view, its own statement) and runs again as a no-op", async () => {
    await t.pool.query("drop view public.weather_warnings_area_live_de");
    await t.pool.query(`create view weather_warnings_area_live_de as
      select w.identifier, w.warncell_id, w.event, w.level, w.level_source, w.headline, w.valid_from, w.valid_to,
             w.area, w.source_id, w.closed_at, w.description, w.instruction
        from weather_warnings_live w`);
    await t.pool.query("grant select on weather_warnings_area_live_de to viafrei_digest");
    const run = await rerun(328);
    expect(run.ok, run.text).toBe(true);
    expect(run.applying).toEqual(["applying 0328_weather_warnings_area_live_de.sql"]);
    expect((await t.pool.query<{ c: string | null }>("select obj_description('public.weather_warnings_area_live_de'::regclass) as c")).rows[0]?.c).toMatch(/Migration 0328/);
  });

  it("every day partition of autobahn_events carries the analyze settings, and no other tick table's does", async () => {
    const days = await partOptions(t.pool, "public.autobahn_events");
    expect(Object.keys(days).length).toBeGreaterThanOrEqual(11);
    for (const [n, o] of Object.entries(days)) expect(o, n).toEqual(expect.arrayContaining(WANT));
    for (const o of Object.values(await partOptions(t.pool, "public.transit_delays"))) expect(o.filter((x) => x.startsWith("autovacuum_analyze"))).toEqual([]);
  });

  it("a day ensure_daily_partitions makes later gets them too", async () => {
    // The newest day, dropped and made again by the helper, as a day it reaches for the first time.
    const newest = Object.keys(await partOptions(t.pool, "public.autobahn_events")).sort().at(-1);
    if (newest === undefined) throw new Error("no partition");
    const ahead = (
      await t.pool.query<{ n: number }>("select (to_date(right($1, 8), 'YYYYMMDD') - current_date)::int as n", [newest])
    ).rows[0]?.n;
    await t.pool.query(`drop table public.${newest}`);
    expect(Object.keys(await partOptions(t.pool, "public.autobahn_events"))).not.toContain(newest);
    await t.pool.query("select public.ensure_daily_partitions($1, 3)", [ahead]);
    const after = await partOptions(t.pool, "public.autobahn_events");
    expect(after[newest], newest).toEqual(expect.arrayContaining(WANT));
  });

  it("tick_partition_options sets a partition that lost them once, then nothing; another relation it leaves alone", async () => {
    const part = Object.keys(await partOptions(t.pool, "public.autobahn_events"))[0];
    if (part === undefined) throw new Error("no partition");
    await t.pool.query(`alter table public.${part} reset (autovacuum_analyze_scale_factor, autovacuum_analyze_threshold)`);
    const one = async (rel: string): Promise<number> =>
      (await t.pool.query<{ n: number }>("select public.tick_partition_options($1::regclass) as n", [rel])).rows[0]?.n ?? -1;
    expect(await one(`public.${part}`)).toBe(1);
    expect((await partOptions(t.pool, "public.autobahn_events"))[part]).toEqual(expect.arrayContaining(WANT));
    expect(await one(`public.${part}`)).toBe(0);
    const other = Object.keys(await partOptions(t.pool, "public.transit_delays"))[0];
    if (other === undefined) throw new Error("no transit_delays partition");
    expect(await one(`public.${other}`)).toBe(0);
    expect(await one("public.autobahn_events")).toBe(0);
    expect((await partOptions(t.pool, "public.transit_delays"))[other]?.filter((x) => x.startsWith("autovacuum_analyze"))).toEqual([]);
  });

  it("0329 sets an existing day outside every partition run's window, and run again resets nothing", async () => {
    // A day 20 back, attached by hand without the settings: no ensure run reaches it, only the file's own pass.
    const old = (await t.pool.query<{ n: string }>("select 'autobahn_events_' || to_char(current_date - 20, 'YYYYMMDD') as n")).rows[0]?.n ?? "";
    await t.pool.query(`create table public.${old} (like public.autobahn_events including all excluding indexes excluding statistics)`);
    await t.pool.query(
      `alter table public.autobahn_events attach partition public.${old} for values from ((current_date - 20)::timestamptz) to ((current_date - 19)::timestamptz)`,
    );
    expect((await partOptions(t.pool, "public.autobahn_events"))[old]).toEqual([]);
    const run = await rerun(329);
    expect(run.ok, run.text).toBe(true);
    expect(run.applying).toEqual(["applying 0329_autobahn_events_analyze.sql"]);
    const after = await partOptions(t.pool, "public.autobahn_events");
    expect(after[old], old).toEqual(expect.arrayContaining(WANT));
    const again = await rerun(329);
    expect(again.ok, again.text).toBe(true);
    expect(await partOptions(t.pool, "public.autobahn_events")).toEqual(after);
  });
});
