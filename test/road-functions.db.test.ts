/**
 * The Autobahn and DATEX II road-event functions against a real catalogue:
 * the raw-payload dedupe (autobahn_raw_resolve, autobahn_event_raw), the text
 * fold and the jam-hour rollup, the German validity-text parser
 * (autobahn_validity_date / _time / _overlaps), road_event_suspended and the
 * in-force predicates, road_ref_key, the road_events suspended trigger, and
 * the three road-event readers. Every test runs as the owner in a transaction
 * that is rolled back.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { DomainDb } from "./domain-db.js";
import { one, refused, requireDb, rows, url } from "./schema-db.js";

requireDb("the road functions");

const status = (...s: string[]): unknown => ({ situationRecord: [{ validity: s.map((x) => ({ validityStatus: [{ "#text": x }] })) }] });
const V = "Die Baustelle ist in folgenden Zeiträumen gültig:";

describe.skipIf(url === undefined)("the road functions", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "road_fn");

  beforeAll(async () => {
    await t.make([]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  /** Today's UTC midnight plus the given hours, as the database computes it (inside the day partitions). */
  const h = (c: pg.ClientBase, hours: number): Promise<string> =>
    one<{ x: string }>(c, "select (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + make_interval(secs => $1::float8 * 3600))::text as x", [hours]).then((r) => r.x);
  const event = (c: pg.ClientBase, e: { at: string; road?: string; kind?: string; ext?: string; title?: string | null; subtitle?: string | null; att?: string | null; raw?: unknown; hash?: string | null; lon?: number }): Promise<pg.QueryResult> =>
    c.query(
      `insert into autobahn_events (observed_at, road, kind, ext_id, title, subtitle, abnormal_traffic_type, raw, raw_hash, geom)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, decode($9, 'hex'), case when $10::float8 is null then null else ST_MakePoint($10, 50)::geography end)`,
      [e.at, e.road ?? "A1", e.kind ?? "warning", e.ext ?? "x1", e.title ?? null, e.subtitle ?? null, e.att ?? null, e.raw === undefined ? null : JSON.stringify(e.raw), e.hash ?? null, e.lon ?? null],
    );

  describe("the raw payload, stored once a day", () => {
    it("a row without its raw takes the same day's earlier raw of the same hash; another hash, the previous day or no hash at all gives nothing", async () => {
      await t.planted(async (c) => {
        const [prev, t1, t2, t3] = [await h(c, -0.02), await h(c, 1), await h(c, 2), await h(c, 3)];
        await event(c, { at: prev, raw: { v: "yesterday" }, hash: "bb" });
        await event(c, { at: t1, raw: { v: 1 }, hash: "aa" });
        await event(c, { at: await h(c, 1.5), raw: { v: 2 }, hash: "aa" });
        await event(c, { at: t2, hash: "aa" });
        await event(c, { at: t2, kind: "closure", ext: "x2", hash: "bb" });
        await event(c, { at: t3 });
        const r = await rows<{ a: unknown; b: unknown; c: unknown; d: unknown; e: unknown }>(
          c,
          `select autobahn_event_raw('x1', $1) as a, autobahn_event_raw('x1', $2) as b, autobahn_event_raw('x1', $3) as c,
                  autobahn_raw_resolve(null, decode('cc', 'hex'), 'x1', $2::timestamptz) as d, autobahn_raw_resolve('{"own":1}', decode('aa', 'hex'), 'x1', $2::timestamptz) as e`,
          [t1, t2, t3],
        );
        expect(r[0]).toEqual({ a: { v: 1 }, b: { v: 2 }, c: null, d: null, e: { own: 1 } });
        // x1's raw of hash bb is yesterday's: not today's
        expect((await one<{ x: unknown }>(c, "select autobahn_raw_resolve(null, decode('bb', 'hex'), 'x1', $1::timestamptz) as x", [t2])).x).toBeNull();
        expect((await one<{ x: unknown }>(c, "select autobahn_event_raw('x2', $1) as x", [t2])).x).toBeNull();
      });
    });

    it("of two kinds at one instant, the row that carries its raw answers", async () => {
      await t.planted(async (c) => {
        const t1 = await h(c, 1);
        await event(c, { at: t1, kind: "closure" });
        await event(c, { at: t1, kind: "warning", raw: { v: "w" } });
        expect((await one<{ x: unknown }>(c, "select autobahn_event_raw('x1', $1) as x", [t1])).x).toEqual({ v: "w" });
      });
    });
  });

  describe("autobahn_event_texts_backfill", () => {
    it("folds each road's distinct title and subtitle to its first and last sighting with the last sighting's position; a later run widens, never narrows", async () => {
      await t.planted(async (c) => {
        const [t1, t2, t3] = [await h(c, 1), await h(c, 2), await h(c, 3)];
        await event(c, { at: t1, title: "Stau", subtitle: "AS Nord", lon: 7 });
        await event(c, { at: t2, title: "Stau", subtitle: "AS Nord", lon: 8 });
        await event(c, { at: t2, title: null, subtitle: null, ext: "x2" });
        await event(c, { at: t3, road: "A2", title: "Stau", subtitle: "AS Nord", lon: 9 });
        expect((await one<{ n: string }>(c, "select autobahn_event_texts_backfill() as n")).n).toBe("3");
        const texts = async (): Promise<string[]> =>
          (
            await rows<{ x: string }>(
              c,
              "select road || '|' || title || '|' || subtitle || '|' || first_seen_at::text || '|' || last_seen_at::text || '|' || coalesce(ST_X(geom::geometry)::text, '-') as x from autobahn_event_texts order by 1",
            )
          ).map((x) => x.x);
        expect(await texts()).toEqual([`A1|||${t2}|${t2}|-`, `A1|Stau|AS Nord|${t1}|${t2}|8`, `A2|Stau|AS Nord|${t3}|${t3}|9`]);
        const t4 = await h(c, 4);
        await event(c, { at: t4, title: "Stau", subtitle: "AS Nord", lon: 6 });
        expect((await one<{ n: string }>(c, "select autobahn_event_texts_backfill($1) as n", [t4])).n).toBe("1");
        expect(await texts()).toContain(`A1|Stau|AS Nord|${t1}|${t4}|6`);
      });
    });
  });

  describe("autobahn_jam_rollup_refresh", () => {
    it("each hour and road is a row with its jams' titles, a road without jams an empty one; a second run writes nothing; an empty or overlong window is refused", async () => {
      await t.planted(async (c) => {
        const [t1, t1b, t2, t3] = [await h(c, 1.2), await h(c, 1.5), await h(c, 2.1), await h(c, 0)];
        await event(c, { at: t1, title: "Stau", subtitle: "b", att: "stationaryTraffic" });
        await event(c, { at: t1b, title: "Stau", subtitle: "a", att: "queuingTraffic", ext: "x2" });
        await event(c, { at: t1b, title: "Baustelle", kind: "roadworks", att: "x", ext: "x3" });
        await event(c, { at: t2, title: null, att: "stationaryTraffic", ext: "x4" });
        await event(c, { at: t3, road: "A3", title: "Stau", kind: "warning", att: null, ext: "x5" });
        const from = await h(c, 0);
        const to = await h(c, 3);
        expect((await one<{ n: number }>(c, "select autobahn_jam_rollup_refresh($1, $2) as n", [from, to])).n).toBe(3);
        const r = await rows<{ x: string }>(c, "select to_char(hour_start at time zone 'UTC', 'HH24') || ' ' || road || ' ' || jam_titles::text || ' ' || jam_subtitles::text as x from autobahn_jam_hours order by 1");
        expect(r.map((x) => x.x)).toEqual(["00 A3 {} {}", "01 A1 {Stau,Stau} {a,b}", "02 A1 {} {}"]);
        expect((await one<{ n: number }>(c, "select autobahn_jam_rollup_refresh($1, $2) as n", [from, to])).n).toBe(0);
        expect((await refused(c, "select autobahn_jam_rollup_refresh($1, $1)", [from]))?.message).toMatch(/must be non-empty/);
        expect((await refused(c, "select autobahn_jam_rollup_refresh($1::timestamptz - interval '2 days 1 second', $1)", [to]))?.message).toMatch(/longer than 2 days/);
        // without a start, the window reaches back to the newest hour held, at least an hour, at most a day
        expect((await refused(c, "select autobahn_jam_rollup_refresh(null, $1)", [to]))).toBeNull();
      });
    });
  });

  describe("the validity texts", () => {
    it("autobahn_validity_date and _time take only real dates and clock times, 24:00 included", async () => {
      const r = await one<Record<string, string | null>>(
        t.pool,
        `select autobahn_validity_date('29', '2', '24')::text as leap, autobahn_validity_date('29', '2', '2026')::text as noleap,
                autobahn_validity_date('31', '4', '26')::text as april31, autobahn_validity_date('1', '13', '26')::text as m13,
                autobahn_validity_date('0', '1', '26')::text as d0, autobahn_validity_date('1', '1', '026')::text as y3,
                autobahn_validity_date('x', '1', '26')::text as junk, autobahn_validity_date('5', '1', '2026')::text as full_year,
                autobahn_validity_time('24', '00')::text as midnight, autobahn_validity_time('24', '01')::text as past,
                autobahn_validity_time('23', '60')::text as m60, autobahn_validity_time('7', '5')::text as onedigit, autobahn_validity_time('7', '05')::text as ok`,
      );
      expect(r).toEqual({ leap: "2024-02-29", noleap: null, april31: null, m13: null, d0: null, y3: null, junk: null, full_year: "2026-01-05", midnight: "24:00:00", past: null, m60: null, onedigit: null, ok: "07:05:00" });
    });

    const overlaps = async (lines: string[], from: string, to: string): Promise<boolean | null> =>
      (await one<{ x: boolean | null }>(t.pool, "select autobahn_validity_overlaps($1::jsonb, $2, $3) as x", [JSON.stringify(lines), from, to])).x;

    it("weekly windows: a weekday inside the dates and hours overlaps, another weekday or hour does not, an excepted day does not; 'Tag' is every day", async () => {
      const weekly = [V, "Jeden Montag und Mittwoch zwischen dem 05.01.2026 und dem 30.01.2026 von 08:00 bis 16:00"];
      // 2026-01-12 is a Monday; Berlin is UTC+1 in January
      expect(await overlaps(weekly, "2026-01-12T09:00:00Z", "2026-01-12T09:30:00Z")).toBe(true);
      expect(await overlaps(weekly, "2026-01-13T09:00:00Z", "2026-01-13T09:30:00Z")).toBe(false);
      expect(await overlaps(weekly, "2026-01-12T16:00:00Z", "2026-01-12T17:00:00Z")).toBe(false);
      expect(await overlaps(weekly, "2026-02-02T09:00:00Z", "2026-02-02T09:30:00Z")).toBe(false);
      expect(await overlaps([...weekly, "", "Die Baustelle gilt nicht an folgenden Tagen:", "12.01.2026"], "2026-01-12T09:00:00Z", "2026-01-12T09:30:00Z")).toBe(false);
      expect(await overlaps([V, "Jeden Tag zwischen dem 05.01.2026 und dem 30.01.2026 von 22:00 bis 06:00"], "2026-01-13T03:00:00Z", "2026-01-13T03:10:00Z")).toBe(true);
    });

    it("a stated span and a one-day window, overnight included; no stated window is null, not false", async () => {
      expect(await overlaps([V, "05.01.2026, 08:00 bis 07.01.2026, 16:00"], "2026-01-06T12:00:00Z", "2026-01-06T13:00:00Z")).toBe(true);
      expect(await overlaps([V, "05.01.2026 um 08:00 Uhr bis zum 07.01.2026 um 16:00"], "2026-01-07T15:00:00Z", "2026-01-07T16:00:00Z")).toBe(false);
      expect(await overlaps([V, "10.01.2026 von 22:00 bis 06:00"], "2026-01-11T04:00:00Z", "2026-01-11T04:30:00Z")).toBe(true);
      expect(await overlaps([V, "10.01.2026 von 22:00 bis 06:00"], "2026-01-11T05:00:00Z", "2026-01-11T05:30:00Z")).toBe(false);
      expect(await overlaps([V, "irgendwann bald"], "2026-01-11T04:00:00Z", "2026-01-11T04:30:00Z")).toBeNull();
      expect(await overlaps(["Stau auf der A1"], "2026-01-11T04:00:00Z", "2026-01-11T04:30:00Z")).toBeNull();
      expect((await one<{ x: boolean | null }>(t.pool, "select autobahn_validity_overlaps(jsonb_build_object('a', 'In folgenden Zeiträumen gültig:'), now(), now()) as x")).x).toBeNull();
    });
  });

  describe("road events in force", () => {
    it("road_event_suspended: true only when every validity status is suspended; no status, a mixed one or no array is not suspended", async () => {
      const r = await one<Record<string, boolean>>(
        t.pool,
        "select road_event_suspended($1) as all_s, road_event_suspended($2) as mixed, road_event_suspended($3) as active, road_event_suspended('{}') as none, road_event_suspended('{\"situationRecord\": {\"validity\": 1}}') as notarray",
        [JSON.stringify(status("suspended", "suspended")), JSON.stringify(status("suspended", "active")), JSON.stringify(status("active"))],
      );
      expect(r).toEqual({ all_s: true, mixed: false, active: false, none: false, notarray: false });
    });

    it("road_event_in_force and _known: outside the overall span, outside the stated windows or suspended is not in force; a known suspended flag wins over the payload", async () => {
      const S = JSON.stringify(status("suspended"));
      const A = JSON.stringify(status("active"));
      const r = await one<Record<string, boolean>>(
        t.pool,
        `select road_event_in_force(now() - interval '1 h', now() + interval '1 h', $2, now()) as inside,
                road_event_in_force(now() + interval '1 h', null, $2, now()) as before_start,
                road_event_in_force(null, now() - interval '1 h', $2, now()) as after_end,
                road_event_in_force(null, null, $1, now()) as suspended,
                road_event_in_force(null, null, $2, tstzmultirange(tstzrange(now() + interval '1 h', null)), now()) as outside_windows,
                road_event_in_force(null, null, $2, tstzmultirange(tstzrange(now() - interval '1 h', null)), now()) as inside_windows,
                road_event_in_force(null, null, $2, null::tstzmultirange, now()) as no_windows,
                road_event_in_force_known(null, null, false, $1, null, now()) as known_active,
                road_event_in_force_known(null, null, true, $2, null, now()) as known_suspended,
                road_event_in_force_known(null, null, null, $1, null, now()) as unknown_suspended,
                road_event_in_force_known(now() + interval '1 h', null, false, $2, null, now()) as known_before,
                road_event_in_force_known(null, now() - interval '1 h', false, $2, null, now()) as known_after,
                road_event_in_force_known(null, null, false, $2, tstzmultirange(tstzrange(now() + interval '1 h', null)), now()) as known_outside`,
        [S, A],
      );
      expect(r).toEqual({
        inside: true, before_start: false, after_end: false, suspended: false, outside_windows: false, inside_windows: true, no_windows: true,
        known_active: true, known_suspended: false, unknown_suspended: false, known_before: false, known_after: false, known_outside: false,
      });
    });

    it("road_ref_key: case, spaces, dots, dashes and leading zeros folded; an empty road is null", async () => {
      const r = await one<Record<string, string | null>>(
        t.pool,
        "select road_ref_key(' a 007 ') as a7, road_ref_key('A-1') as a1, road_ref_key('b 27a') as b27a, road_ref_key('L.123') as l123, road_ref_key('A100') as a100, road_ref_key('Ring') as ring, road_ref_key(' - ') as empty, road_ref_key(null) as nul",
      );
      expect(r).toEqual({ a7: "A7", a1: "A1", b27a: "B27A", l123: "L123", a100: "A100", ring: "RING", empty: null, nul: null });
    });
  });

  describe("public.road_events and its readers", () => {
    const insert = (c: pg.ClientBase, pub: string, payload: unknown, extra: Record<string, unknown> = {}): Promise<{ id: string }> =>
      one<{ id: string }>(
        c,
        `insert into road_events (feed_key, source_id, publication_id, version, payload, suspended, overall_start, overall_end, closed_at, deleted_at, confidentiality, valid_windows)
         values ('f', 's', $1, 1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9::tstzmultirange) returning id::text`,
        [pub, JSON.stringify(payload), extra["suspended"] ?? null, extra["start"] ?? null, extra["end"] ?? null, extra["closed"] ?? null, extra["deleted"] ?? null, extra["conf"] ?? null, extra["windows"] ?? null],
      );

    it("the suspended flag is derived from the payload on insert and on a payload update, whatever the writer sets", async () => {
      await t.planted(async (c) => {
        const { id } = await insert(c, "p1", status("suspended"), { suspended: false });
        const flag = async (): Promise<boolean | null> => (await one<{ s: boolean | null }>(c, "select suspended as s from road_events where id = $1", [id])).s;
        expect(await flag()).toBe(true);
        await c.query("update road_events set payload = $2 where id = $1", [id, JSON.stringify(status("active"))]);
        expect(await flag()).toBe(false);
        await c.query("update road_events set suspended = true where id = $1", [id]);
        expect(await flag()).toBe(true);
        await c.query("update road_events set suspended = true, payload = payload where id = $1", [id]);
        expect(await flag()).toBe(false);
      });
    });

    it("road_events_live drops the deleted; road_events_current also the closed, the not in force and the confidential", async () => {
      await t.planted(async (c) => {
        const A = status("active");
        const ids: Record<string, string> = {};
        for (const [k, p, x] of [
          ["open", A, {}],
          ["deleted", A, { deleted: "now()" }],
          ["closed", A, { closed: new Date().toISOString() }],
          ["suspended", status("suspended"), {}],
          ["future", A, { start: new Date(Date.now() + 3_600_000).toISOString() }],
          ["ended", A, { end: new Date(Date.now() - 3_600_000).toISOString() }],
          ["windowed", A, { windows: `{[${new Date(Date.now() + 3_600_000).toISOString()},)}` }],
          ["secret", A, { conf: "restrictedToAuthorities" }],
          ["public", A, { conf: "noRestriction" }],
        ] as [string, unknown, Record<string, unknown>][]) {
          ids[k] = (await insert(c, k, p, { ...x, deleted: x["deleted"] === undefined ? null : new Date().toISOString() })).id;
        }
        const pubs = async (v: string): Promise<string[]> => (await rows<{ p: string }>(c, `select publication_id as p from ${v} order by 1`)).map((x) => x.p);
        expect(await pubs("road_events_live")).toEqual(["closed", "ended", "future", "open", "public", "secret", "suspended", "windowed"]);
        expect(await pubs("road_events_current")).toEqual(["open", "public"]);
        await c.query("insert into road_event_locations (road_event_id, seq) values ($1, 1), ($1, 2), ($2, 1)", [ids["open"], ids["deleted"]]);
        await c.query("update road_event_locations set deleted_at = now() where road_event_id = $1 and seq = 2", [ids["open"]]);
        const locs = await rows<{ x: string }>(c, "select road_event_id::text || ':' || seq as x from road_event_locations_live order by 1");
        expect(locs.map((x) => x.x)).toEqual([`${ids["open"] ?? ""}:1`]);
      });
    });
  });
});
