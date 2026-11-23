/**
 * 0330: the per-row values the road readers derive on every read, as stored functions.
 *
 *  - autobahn_validity_overlaps, re-created as one pass, answers as the two-pass body of the
 *    0293 baseline (read from that file and created here under another name) on every planted
 *    description, at every sampled instant and over ranges; the planted lines put the except
 *    section before and after the window list, a line under both headings, a non-string line,
 *    a 61st line;
 *  - autobahn_validity_stated is false exactly when overlaps is NULL at every sampled instant;
 *  - autobahn_starts_at, autobahn_site_key, autobahn_extent_ends and road_event_entry_static
 *    answer what the application's reader expressions answer on planted payloads (their bodies are
 *    generated from those expressions; the application's parity test runs both on its fixtures);
 *  - road_events_entry_static_backfill fills at most its batch, and stops at 0.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainDb } from "./domain-db.js";
import { one, requireDb, rows, url } from "./schema-db.js";

requireDb("autobahn road derived columns");

const V = "Die Baustelle ist in folgenden Zeiträumen gültig:";
const X = "Die Baustelle gilt nicht an folgenden Tagen:";

/** Descriptions, each sampled over the planted week (2026-10-18 … 2026-10-27, the clocks go back on the 25th). */
const DESCRIPTIONS: unknown[] = [
  ["A1 Test", "", V, "Jeden Montag, Mittwoch und Freitag zwischen dem 19.10.26 und dem 25.10.26 von 08:00 bis 16:00 Uhr.", "", X, "21.10.26"],
  [X, "23.10.26, 24.10.26", "", V, "Jeden Tag zwischen dem 20.10.26 und dem 26.10.26 von 22:00 bis 06:00 Uhr.", "24.10.26 von 10:00 bis 11:00 Uhr"],
  [V, "Jeden Tag zwischen dem 23.10.26 und dem 25.10.26 von 22:00 bis 06:00 Uhr."],
  [V, "20.10.26 22:45 bis zum 22.10.26 05:00 Uhr."],
  [V, "21.10.26 von 09:00 bis 12:00 Uhr", "21.10.26 von 12:00 bis 15:00 Uhr", X, "21.10.26"],
  [V, "24.10.26 von 23:00 bis 01:00 Uhr"],
  // a line under both headings opens the except section and the list at once
  [`${V} ${X}`, "22.10.26 von 08:00 bis 09:00 Uhr", "23.10.26 von 08:00 bis 09:00 Uhr", "", X, "23.10.26"],
  // a non-string line, and a window after it
  [V, 42, null, "22.10.26 von 08:00 bis 09:00 Uhr"],
  // the 61st line is not read
  [V, ...Array.from({ length: 58 }, () => "nichts"), "22.10.26 von 08:00 bis 09:00 Uhr", "23.10.26 von 08:00 bis 09:00 Uhr"],
  // a window line outside the list, then one inside
  ["22.10.26 von 08:00 bis 09:00 Uhr", V, "Jeden Samstag und Sonntag zwischen dem 18.10.26 und dem 26.10.26 von 07:00 bis 19:00 Uhr"],
  [V, "Jeden Feiertag zwischen dem 18.10.26 und dem 26.10.26 von 07:00 bis 19:00 Uhr", "32.10.26 von 08:00 bis 09:00 Uhr"],
  // an empty line ends the except section: the 23rd's date after it excepts nothing
  [V, "Jeden Tag zwischen dem 20.10.26 und dem 26.10.26 von 10:00 bis 11:00 Uhr", "", X, "22.10.26", "", "Hinweis 23.10.26"],
  // the except heading ends the window list: the span after it excepts the 23rd and is no window
  [V, "Jeden Tag zwischen dem 20.10.26 und dem 26.10.26 von 10:00 bis 11:00 Uhr", X, "23.10.26 08:00 bis zum 23.10.26 09:00 Uhr"],
  [V, "01.10.26 von 08:00 bis 09:00 Uhr"],
  ["Stau auf der A1", "20.10.26 von 08:00 bis 09:00 Uhr"],
  [V, "irgendwann bald"],
  "not an array",
  null,
];

/** The two-pass body of the 0293 baseline, as the function test_overlaps_0293. */
function baselineOverlaps(): string {
  const sql = readFileSync(new URL("../db/baseline/0293_baseline.sql", import.meta.url), "utf8");
  const start = sql.indexOf("CREATE FUNCTION public.autobahn_validity_overlaps(");
  const end = sql.indexOf("$_$;", sql.indexOf("AS $_$", start)) + 4;
  if (start < 0 || end < start) throw new Error("the baseline holds no autobahn_validity_overlaps");
  return sql.slice(start, end).replace("public.autobahn_validity_overlaps(", "public.test_overlaps_0293(");
}

describe.skipIf(url === undefined)("autobahn and road derived columns (0330)", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "road_derived");

  beforeAll(async () => {
    await t.make([]);
    await t.pool.query(baselineOverlaps());
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  it("road_events_live is road_events' columns exactly, entry_static among them (0338 appends land_code after it), with its grants and road_events_current kept", async () => {
    const cols = (rel: string): Promise<string[]> =>
      rows<{ a: string }>(t.pool, `select attname as a from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum`, [rel]).then((r) => r.map((x) => x.a));
    const live = await cols("public.road_events_live");
    expect(live).toEqual(await cols("public.road_events"));
    expect(live.slice(-2)).toEqual(["entry_static", "land_code"]);
    const g = await one<{ d: boolean; m: boolean; c: string | null }>(t.pool, `select has_table_privilege('viafrei_digest', 'public.road_events_live', 'select') as d,
      has_table_privilege('viafrei_mcp', 'public.road_events_live', 'select') as m, to_regclass('public.road_events_current')::text as c`);
    expect(g).toEqual({ d: true, m: true, c: "road_events_current" });
  });

  it("the single-pass overlaps answers as the 0293 two-pass body on every planted description, instant and range", async () => {
    const r = await one<{ n: string; differ: string; inside: string; stated: string }>(
      t.pool,
      `with d as (select x as d from jsonb_array_elements($1::jsonb) x),
            s as (select g as a from generate_series('2026-10-18T00:00:00Z'::timestamptz, '2026-10-27T00:00:00Z', interval '15 minutes') g),
            w as (select v.w from (values (interval '0'), (interval '1 minute'), (interval '3 hours'), (interval '2 days')) v(w))
       select count(*)::text as n,
              count(*) filter (where autobahn_validity_overlaps(d.d, s.a, s.a + w.w) is distinct from test_overlaps_0293(d.d, s.a, s.a + w.w))::text as differ,
              count(*) filter (where test_overlaps_0293(d.d, s.a, s.a + w.w))::text as inside,
              count(*) filter (where test_overlaps_0293(d.d, s.a, s.a + w.w) is not null)::text as stated
         from d cross join s cross join w`,
      [JSON.stringify(DESCRIPTIONS)],
    );
    expect(r.differ).toBe("0");
    expect(Number(r.inside)).toBeGreaterThan(0);
    expect(Number(r.stated)).toBeGreaterThan(Number(r.inside));
  });

  it("autobahn_validity_stated is false exactly where overlaps is NULL at every instant", async () => {
    const r = await rows<{ i: string; stated: boolean; any_answer: boolean }>(
      t.pool,
      `select x.i::text as i, autobahn_validity_stated(x.d) as stated,
              bool_or(test_overlaps_0293(x.d, g, g) is not null) as any_answer
         from jsonb_array_elements($1::jsonb) with ordinality x(d, i)
         cross join generate_series('2026-10-18T00:00:00Z'::timestamptz, '2026-10-27T00:00:00Z', interval '1 hour') g
        group by x.i, x.d order by x.i`,
      [JSON.stringify(DESCRIPTIONS)],
    );
    expect(r.map((x) => x.stated)).toEqual(r.map((x) => x.any_answer));
    expect(r.filter((x) => x.stated).length).toBe(13);
  });

  it("autobahn_starts_at reads startTimestamp, else the stated Berlin start, and the future flag", async () => {
    const r = await rows<{ s: Date | null; f: boolean }>(
      t.pool,
      `select (autobahn_starts_at(x)).starts_at as s, (autobahn_starts_at(x)).future as f
         from jsonb_array_elements($1::jsonb) with ordinality a(x, o) order by o`,
      [
        JSON.stringify([
          { startTimestamp: "2026-10-21T08:00:00+02:00", future: true, description: ["Beginn: 01.01.26 um 01:00"] },
          { startTimestamp: "bald", description: ["A1", "Beginn: 21.10.26 um 08:00"] },
          { description: ["a", "b", "c", "d", "Beginn: 21.10.26 um 08:00"] },
          { description: ["gültig: 25.10.2026 von 02:30"] },
          { description: "Beginn: 21.10.26 um 08:00", future: "true" },
        ]),
      ],
    );
    expect(r.map((x) => (x.s === null ? null : new Date(x.s).toISOString()))).toEqual([
      "2026-10-21T06:00:00.000Z",
      "2026-10-21T06:00:00.000Z",
      null,
      "2026-10-25T01:30:00.000Z",
      null,
    ]);
    expect(r.map((x) => x.f)).toEqual([true, false, false, false, true]);
  });

  it("autobahn_site_key folds the id's .deN suffix, keeps the extent only without a title, and carries the start", async () => {
    const key = (ext: string, title: string | null, extent: string): Promise<unknown> =>
      one<{ k: unknown }>(
        t.pool,
        `select autobahn_site_key('A1', 'roadworks', $1, $2, null, $3, null, null, $4::jsonb, '2026-10-21T06:00:00Z', false) as k`,
        [ext, title, extent, JSON.stringify({ isBlocked: "false", startTimestamp: "2026-10-21T08:00:00+02:00", description: ["Zeile eins", "Zeile zwei", "", "Rest"] })],
      ).then((x) => x.k);
    const a = (await key("abc.de1", "Baustelle", "50,8,51,9")) as unknown[];
    expect(a).toHaveLength(14);
    expect(a.slice(0, 6)).toEqual(["A1", "roadworks", "abc", "Baustelle", null, null]);
    expect(a.slice(8, 13)).toEqual(["false", null, "2026-10-21T06:00:00+00:00", false, "2026-10-21 06:00:00+00"]);
    expect(a[13]).toEqual(["Zeile eins", "Zeile zwei"]);
    expect(await key("abc.de7", "Baustelle", "1,2,3,4")).toEqual(a);
    expect(((await key("abc.de1", " ", "50,8,51,9")) as unknown[])[5]).toBe("50,8,51,9");
  });

  it("autobahn_extent_ends places the extent's two ends, drops 0,0 and out-of-range points, and is NULL with none", async () => {
    const r = await rows<{ e: string | null }>(
      t.pool,
      `select st_astext(autobahn_extent_ends(x)) as e from unnest($1::text[]) with ordinality a(x, o) order by o`,
      [["50.1,8.2,50.3,8.4", " 50.1 , 8.2 ,0,0", "50.1,8.2,50.1,8.2", "95,8,50,8", "50,8,51", null]],
    );
    expect(r.map((x) => x.e)).toEqual(["MULTIPOINT((8.2 50.1),(8.4 50.3))", "MULTIPOINT((8.2 50.1))", "MULTIPOINT((8.2 50.1))", "MULTIPOINT((8 50))", null, null]);
  });

  const SITUATION = {
    situationRecord: [
      {
        groupOfLocations: {
          alertCMethod2PrimaryPointLocation: { alertCLocation: { specificLocation: { "#text": "12345" } } },
          alertCMethod4SecondaryPointLocation: { alertCLocation: { specificLocation: { "#text": "12346" } } },
          alertCDirectionCoded: { "#text": "positive" },
          gmlLineString: { posList: { "#text": "50 8 51 9" } },
        },
        generalPublicComment: [
          { comment: { values: { value: { "#text": "Sanierung" } } }, commentExtension: { commentExtended: { commentType2: { "#text": "roadworksType" } } } },
        ],
      },
      { groupOfLocations: { linearExtension: { alertCDirectionCoded: { "#text": "negative" } } } },
    ],
  };

  it("road_event_entry_static reads the first record's place, works type and line, and every record's senses", async () => {
    const r = await one<{ e: unknown }>(t.pool, `select road_event_entry_static($1::jsonb) as e`, [JSON.stringify(SITUATION)]);
    expect(r.e).toEqual({ pri: "12345", sec: "12346", senses: ["positive", "negative"], works: "Sanierung", line: "50 8 51 9" });
    const empty = await one<{ e: unknown }>(t.pool, `select road_event_entry_static('{}'::jsonb) as e`);
    expect(empty.e).toEqual({ pri: null, sec: null, senses: [], works: null, line: null });
  });

  it("road_events_entry_static_backfill fills at most its batch, oldest first, then answers 0", async () => {
    await t.pool.query(
      `insert into road_events (feed_key, source_id, publication_id, version, payload)
       select 'test', 'src', 'p' || g, 1, $1::jsonb from generate_series(1, 3) g order by g`,
      [JSON.stringify(SITUATION)],
    );
    // rows written before 0330: the trigger fills every new one, so the backfill's rows are made unfilled
    await t.pool.query("update road_events set entry_static = null");
    // the backfill's walk has its own index: the unfilled ids, in order
    const ix = await one<{ d: string }>(t.pool, "select indexdef as d from pg_indexes where indexname = 'road_events_entry_static_unfilled'");
    expect(ix.d).toBe("CREATE INDEX road_events_entry_static_unfilled ON public.road_events USING btree (id) WHERE (entry_static IS NULL)");
    const fill = (n: number): Promise<number> => one<{ n: number }>(t.pool, `select road_events_entry_static_backfill($1) as n`, [n]).then((x) => x.n);
    expect(await fill(2)).toBe(2);
    expect((await rows<{ id: string }>(t.pool, `select publication_id as id from road_events where entry_static is null`)).map((x) => x.id)).toEqual(["p3"]);
    expect(await fill(2)).toBe(1);
    expect(await fill(2)).toBe(0);
    const same = await one<{ n: string }>(t.pool, `select count(*)::text as n from road_events where entry_static = road_event_entry_static(payload)`);
    expect(same.n).toBe("3");
  });

  it("road_events_entry_static fills a new row, follows the loader's payload upsert, and leaves a write without payload alone", async () => {
    await t.pool.query("delete from road_events");
    const other = { situationRecord: [{ groupOfLocations: { gmlLineString: { posList: { "#text": "50.1 8.6 50.2 8.7" } } } }] };
    await t.pool.query(
      `insert into road_events (feed_key, source_id, publication_id, version, payload) values ('test', 'src', 'up', 1, $1::jsonb)`,
      [JSON.stringify(SITUATION)],
    );
    const facts = (): Promise<{ ok: boolean; line: unknown }> =>
      one<{ ok: boolean; line: unknown }>(t.pool, `select entry_static is not distinct from road_event_entry_static(payload) and entry_static is not null as ok, entry_static->'line' as line from road_events where publication_id = 'up'`);
    expect((await facts()).ok).toBe(true);
    // the loader's upsert: the same key again, a new payload
    await t.pool.query(
      `insert into road_events (feed_key, source_id, publication_id, version, payload) values ('test', 'src', 'up', 2, $1::jsonb)
       on conflict (source_id, publication_id) do update set payload = excluded.payload, version = excluded.version`,
      [JSON.stringify(other)],
    );
    const after = await facts();
    expect(after.ok).toBe(true);
    expect(after.line).toBe("50.1 8.6 50.2 8.7");
    // a write of another column keeps what the payload says
    await t.pool.query("update road_events set version = 3 where publication_id = 'up'");
    expect((await facts()).ok).toBe(true);
  });

  it("autobahn_events_derived_reset sets the derived values NULL when a column they come from is updated, never when another is", async () => {
    await t.pool.query(
      `insert into autobahn_events (observed_at, road, kind, ext_id, title, source, raw, derived_starts_at, derived_future, derived_site_key,
                                    derived_extent_ends, validity_next_change, states_validity, validity_at_write)
       select now(), 'A1', 'roadworks', 'rs-' || c, 'A1 | X - Y', 'autobahn', '{}'::jsonb, now(), false, md5('k')::uuid,
              'MULTIPOINT(8 50, 8.1 50.1)'::geography, now() + interval '1 hour', true, true
         from unnest($1::text[]) c`,
      [["title", "subtitle", "raw", "road", "kind", "abnormal_traffic_type", "delay_s", "extent", "raw_hash", "source"]],
    );
    const set: Record<string, string> = {
      title: "title = 'A1 | Z'", subtitle: "subtitle = 's'", raw: "raw = '{\"future\": true}'::jsonb", road: "road = 'A2'", kind: "kind = 'closure'",
      abnormal_traffic_type: "abnormal_traffic_type = 'queue'", delay_s: "delay_s = 60", extent: "extent = '1,2,3,4'", raw_hash: "raw_hash = '\\x00'::bytea",
      source: "source = 'other'",
    };
    for (const [c, expr] of Object.entries(set)) await t.pool.query(`update autobahn_events set ${expr} where ext_id = $1`, [`rs-${c}`]);
    const r = await rows<{ c: string; filled: number }>(
      t.pool,
      `select substr(ext_id, 4) as c,
              num_nonnulls(derived_starts_at, derived_future, derived_site_key, derived_extent_ends, validity_next_change, states_validity, validity_at_write) as filled
         from autobahn_events where ext_id like 'rs-%' order by 1`,
    );
    expect(Object.fromEntries(r.map((x) => [x.c, x.filled]))).toEqual({
      abnormal_traffic_type: 0, delay_s: 0, extent: 0, kind: 0, raw: 0, raw_hash: 0, road: 0, source: 7, subtitle: 0, title: 0,
    });
  });
});
