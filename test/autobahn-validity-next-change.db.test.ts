/**
 * autobahn_validity_next_change (0330) against autobahn_validity_overlaps, over a planted week of
 * windows (2026-10-19 … 2026-10-26, Berlin; the clocks go back on 2026-10-25): a weekly window with
 * an excepted day, an overnight daily window across the change, a stated span, two touching
 * windows of one day, windows all in the past, and descriptions that state none.
 *
 * Three claims, each at every sampled instant (every 30 minutes of the week, and every bound
 * ±1 ms):
 *  - the oracle: next_change(at) is the smallest bound of the description later than `at`, the
 *    bounds listed here by hand in UTC; 'infinity' when windows are stated but none is later;
 *    NULL when none is stated;
 *  - agreement: overlaps(x, x) is the same at every sampled x in [at, next_change(at));
 *  - the bounds are real: at each listed bound where a window opens or closes, overlaps differs
 *    1 ms before it and at it (and not at the touching bound, where one window hands over).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainDb } from "./domain-db.js";
import { requireDb, rows, url } from "./schema-db.js";

requireDb("autobahn_validity_next_change");

const V = "Die Baustelle ist in folgenden Zeiträumen gültig:";

type Case = { name: string; description: unknown; bounds: string[] | null; touching?: string[] };

const CASES: Case[] = [
  {
    // Mon 19, Wed 21 (excepted), Fri 23 October, 08:00–16:00 CEST (UTC+2)
    name: "weekly, an excepted day",
    description: ["A1 Test", "", V, "Jeden Montag, Mittwoch und Freitag zwischen dem 19.10.26 und dem 25.10.26 von 08:00 bis 16:00 Uhr.", "", "Die Baustelle gilt nicht an folgenden Tagen:", "21.10.26"],
    bounds: ["2026-10-19T06:00:00Z", "2026-10-19T14:00:00Z", "2026-10-23T06:00:00Z", "2026-10-23T14:00:00Z"],
  },
  {
    // every night 22:00–06:00 from the 23rd to the 25th; the 25th's 06:00 and 22:00 are CET (UTC+1)
    name: "overnight daily, across the change of the clocks",
    description: [V, "Jeden Tag zwischen dem 23.10.26 und dem 25.10.26 von 22:00 bis 06:00 Uhr."],
    bounds: ["2026-10-23T20:00:00Z", "2026-10-24T04:00:00Z", "2026-10-24T20:00:00Z", "2026-10-25T05:00:00Z", "2026-10-25T21:00:00Z", "2026-10-26T05:00:00Z"],
  },
  {
    name: "a stated span",
    description: [V, "20.10.26 22:45 bis zum 22.10.26 05:00 Uhr."],
    bounds: ["2026-10-20T20:45:00Z", "2026-10-22T03:00:00Z"],
  },
  {
    name: "two touching windows of one day",
    description: [V, "21.10.26 von 09:00 bis 12:00 Uhr", "21.10.26 von 12:00 bis 15:00 Uhr"],
    bounds: ["2026-10-21T07:00:00Z", "2026-10-21T10:00:00Z", "2026-10-21T13:00:00Z"],
    touching: ["2026-10-21T10:00:00Z"],
  },
  {
    // one day's window past midnight: 23:00 on the 24th to 01:00 on the 25th, both still CEST
    name: "one day's window past midnight",
    description: [V, "24.10.26 von 23:00 bis 01:00 Uhr"],
    bounds: ["2026-10-24T21:00:00Z", "2026-10-24T23:00:00Z"],
  },
  { name: "windows all before the week", description: [V, "01.10.26 von 08:00 bis 09:00 Uhr"], bounds: [] },
  { name: "no heading", description: ["Stau auf der A1", "20.10.26 von 08:00 bis 09:00 Uhr"], bounds: null },
  { name: "a heading and no readable window", description: [V, "irgendwann bald"], bounds: null },
];

const FROM = "2026-10-18T00:00:00Z";
const TO = "2026-10-27T00:00:00Z";

type Sample = { at: string; nc: string | null; ov: boolean | null };

describe.skipIf(url === undefined)("autobahn_validity_next_change", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "next_change");

  beforeAll(async () => {
    await t.make([]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  /** Every 30 minutes of the week and each bound ±1 ms: the instant, next_change there, overlaps there. */
  const sample = (c: Case): Promise<Sample[]> =>
    rows<{ at: Date; nc: string | null; ov: boolean | null }>(
      t.pool,
      `with s as (
         select g as at from generate_series($2::timestamptz, $3::timestamptz, interval '30 minutes') g
         union select b + d * interval '1 millisecond' from unnest($4::timestamptz[]) b cross join (values (-1), (0), (1)) v(d)
       )
       select s.at,
              case when n.nc = 'infinity' then 'infinity' else to_char(n.nc at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end as nc,
              autobahn_validity_overlaps($1::jsonb, s.at, s.at) as ov
         from s cross join lateral (select autobahn_validity_next_change($1::jsonb, s.at) as nc) n
        order by s.at`,
      [JSON.stringify(c.description), FROM, TO, c.bounds ?? []],
    ).then((r) => r.map((x) => ({ at: new Date(x.at).toISOString(), nc: x.nc, ov: x.ov })));

  it("next_change is the next bound at every sampled instant, in every case", async () => {
    for (const c of CASES) {
      const s = await sample(c);
      expect(s.length, c.name).toBeGreaterThan(400);
      for (const x of s) {
        if (c.bounds === null) {
          expect(x.nc, `${c.name} ${x.at}`).toBeNull();
          continue;
        }
        const later = c.bounds.map((b) => new Date(b).toISOString()).filter((b) => b > x.at).sort();
        expect(x.nc, `${c.name} ${x.at}`).toBe(later[0] ?? "infinity");
      }
    }
  });

  it.for(CASES.map((c) => [c.name, c] as const))("%s: overlaps does not change before next_change", async ([, c]) => {
    const s = await sample(c);
    for (const [i, x] of s.entries()) {
      for (const y of s.slice(i)) {
        if (x.nc === null || (x.nc !== "infinity" && y.at >= x.nc)) break;
        expect(y.ov, `${x.at} .. ${y.at} (next ${x.nc})`).toBe(x.ov);
      }
    }
  });

  it.for(CASES.filter((c) => (c.bounds ?? []).length > 0).map((c) => [c.name, c] as const))("%s: every bound but a touching one flips overlaps, 1 ms before it against at it", async ([, c]) => {
    const s = new Map((await sample(c)).map((x) => [x.at, x.ov]));
    for (const b of c.bounds!) {
      const at = new Date(b);
      const before = s.get(new Date(at.getTime() - 1).toISOString());
      const on = s.get(at.toISOString());
      if ((c.touching ?? []).includes(b)) expect(on, b).toBe(before);
      else expect(on, b).not.toBe(before);
    }
  });

  it("the week is not vacuous: each kind of window is inside at some instant and outside at another", async () => {
    for (const c of CASES.slice(0, 5)) {
      const ov = new Set((await sample(c)).map((x) => x.ov));
      expect(ov, c.name).toEqual(new Set([true, false]));
    }
  });
});
