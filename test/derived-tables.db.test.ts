/**
 * The tables the schema keeps from others, by behaviour (#32): the charging
 * status run ledger its three statement triggers keep from the ticks, the LEZ
 * overlaps its two row triggers keep from the zones, and fuel_warm_cadence's
 * median price gap over the warm stations.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { DomainDb } from "./domain-db.js";
import { one, requireDb, rows, url } from "./schema-db.js";

requireDb("the derived tables");

describe.skipIf(url === undefined)("the derived tables", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "derived");

  beforeAll(async () => {
    await t.make([]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  describe("charging_status_runs", () => {
    const runs = async (c: pg.ClientBase): Promise<string[]> =>
      (
        await rows<{ x: string }>(
          c,
          `select source_feed || ' ' || coalesce(source_run_id::text, '-') || ' ' || is_delta || ' ' || ticks || ' ' ||
                  extract(epoch from (observed_at - stated_at))::int as x
             from charging_status_runs`,
        )
      )
        .map((x) => x.x)
        .sort();
    const tick = (c: pg.ClientBase, evse: string, extra: Record<string, string>): Promise<pg.QueryResult> => {
      const cols = { observed_at: "$1", evse_id: `'${evse}'`, source_feed: "'f'", raw: "'{}'", source_run_id: "1", ...extra };
      return c.query(`insert into charging_point_status (${Object.keys(cols).join(", ")}) values (${Object.values(cols).join(", ")})`, [T]);
    };
    const T = "2026-11-15T10:00:00Z";

    it("an insert notes one run per instant, feed, run and kind: the feed's time for a snapshot, the newest last_updated for a delta, never later than the tick, the confidential not counted; a second insert adds to it; a run older than 35 days goes", async () => {
      await t.planted(async (c) => {
        await c.query("insert into charging_status_runs values (now() - interval '36 days', 'old', null, false, now() - interval '36 days', 1)");
        await tick(c, "e1", { feed_ts: "$1::timestamptz - interval '600 seconds'" });
        await tick(c, "e2", { exchange_protocol: "' DeltaPull '", last_updated: "$1::timestamptz - interval '300 seconds'", feed_ts: "$1::timestamptz - interval '900 seconds'" });
        await tick(c, "e3", { feed_ts: "$1::timestamptz - interval '60 seconds'", confidentiality: "'restrictedToAuthorities'" });
        expect(await runs(c)).toEqual(["f 1 false 1 600", "f 1 true 1 300"]);
        await tick(c, "e4", { feed_ts: "$1::timestamptz + interval '60 seconds'" });
        await tick(c, "e5", { exchange_protocol: "'deltapull'" });
        expect(await runs(c)).toEqual(["f 1 false 2 0", "f 1 true 2 0"]);
      });
    });

    it("a delete or an update recomputes the runs it touched from the ticks left: fewer ticks, a moved run, none left is no row", async () => {
      await t.planted(async (c) => {
        await tick(c, "e1", { feed_ts: "$1::timestamptz - interval '600 seconds'" });
        await tick(c, "e2", { feed_ts: "$1::timestamptz - interval '120 seconds'" });
        await tick(c, "e3", { feed_ts: "$1::timestamptz - interval '900 seconds'" });
        expect(await runs(c)).toEqual(["f 1 false 3 120"]);
        await c.query("delete from charging_point_status where evse_id = 'e2'");
        expect(await runs(c)).toEqual(["f 1 false 2 600"]);
        await c.query("update charging_point_status set source_run_id = 2 where evse_id = 'e1'");
        expect(await runs(c)).toEqual(["f 1 false 1 900", "f 2 false 1 600"]);
        await c.query("update charging_point_status set confidentiality = 'restrictedToAuthorities' where evse_id = 'e3'");
        expect(await runs(c)).toEqual(["f 2 false 1 600"]);
        await c.query("delete from charging_point_status");
        expect(await runs(c)).toEqual([]);
      });
    });
  });

  describe("lez_zone_overlaps", () => {
    const box = (x0: number, x1: number): string => `ST_GeomFromText('POLYGON((${String(x0)} 50,${String(x1)} 50,${String(x1)} 51,${String(x0)} 51,${String(x0)} 50))', 4326)`;
    const zone = (c: pg.ClientBase, feed: string, id: string, geom: string, role = "zone", closed = "null"): Promise<pg.QueryResult> =>
      c.query(
        `insert into lez_zones (source_feed, source_publisher, zone_id, role, name, props, geom, content_hash, first_seen_at, last_seen_at, closed_at)
         values ($1, 'p', $2, $3, $2, '{}', ${geom}, 'h', now(), now(), ${closed})`,
        [feed, id, role],
      );
    const overlaps = async (c: pg.ClientBase): Promise<string[]> =>
      (await rows<{ x: string }>(c, "select zone_id || '>' || other_zone_id || ' ' || round(shared_area::numeric, 2) || '/' || round(smaller_area::numeric, 2) as x from lez_zone_overlaps")).map((x) => x.x).sort();

    it("an open zone overlapping an open zone of another feed is a pair both ways with the shared and the smaller area; the same feed, a touching edge, a road or a closed zone is none", async () => {
      await t.planted(async (c) => {
        // first, so every later zone's refresh meets them
        await zone(c, "f2", "road", "ST_GeomFromText('LINESTRING(0.2 50.5,0.8 50.5)', 4326)", "exempt_road");
        await zone(c, "f2", "shut", box(0, 1), "zone", "now()");
        await zone(c, "f1", "A", box(0, 1));
        await zone(c, "f1", "A2", box(0.5, 1.5));
        await zone(c, "f2", "B", box(0.5, 2.5));
        await zone(c, "f2", "touch", box(-1, 0));
        expect(await overlaps(c)).toEqual(["A2>B 1.00/1.00", "A>B 0.50/1.00", "B>A 0.50/1.00", "B>A2 1.00/1.00"]);
      });
    });

    it("closing, moving or re-roling a zone refreshes its pairs; a change of anything else does not", async () => {
      await t.planted(async (c) => {
        await zone(c, "f1", "A", box(0, 1));
        await zone(c, "f2", "B", box(0.5, 2.5));
        await c.query("delete from lez_zone_overlaps");
        await c.query("update lez_zones set name = 'Neu', last_seen_at = now() where zone_id = 'A'");
        await c.query("update lez_zones set geom = geom, role = role, closed_at = closed_at where zone_id = 'A'");
        expect(await overlaps(c)).toEqual([]);
        await c.query(`update lez_zones set geom = ${box(0, 0.75)} where zone_id = 'A'`);
        expect(await overlaps(c)).toEqual(["A>B 0.25/0.75", "B>A 0.25/0.75"]);
        await c.query("update lez_zones set role = 'transfer' where zone_id = 'B'");
        expect(await overlaps(c)).toEqual([]);
        await c.query("update lez_zones set role = 'zone' where zone_id = 'B'");
        expect(await overlaps(c)).toEqual(["A>B 0.25/0.75", "B>A 0.25/0.75"]);
        await c.query("update lez_zones set closed_at = now() where zone_id = 'A'");
        expect(await overlaps(c)).toEqual([]);
      });
    });
  });

  it("fuel_warm_cadence: the median gap between a warm station's prices of one product within the days asked; warm is near a big enough city or a motorway point; a cold station and a lone price are no gaps", async () => {
    await t.planted(async (c) => {
      // Gross at 7 E 50 N (100 000: a 10 km radius), Klein at 9 E (1 000: clamped up to 2 km), Winzig at 10 E (below the minimum)
      await c.query(
        `insert into gazetteer_places (kind, name, name_norm, admin_code, geom, source_id, external_id, population) values
           ('city', 'Gross', 'gross', '05315000', ST_MakePoint(7, 50)::geography, 'bkg_gvisys', 'g', 100000),
           ('city', 'Klein', 'klein', '05315001', ST_MakePoint(9, 50)::geography, 'bkg_gvisys', 'k', 1000),
           ('city', 'Winzig', 'winzig', '05315002', ST_MakePoint(10, 50)::geography, 'bkg_gvisys', 'w', 999)`,
      );
      await c.query(
        "insert into tmc_locations (cid, tabcd, lcd, lcl_version, class, tcd, stcd, road_number, geom) values (58, 1, 1, '1.0', 'P', 1, 1, 'A7', ST_MakePoint(8, 52)::geography)",
      );
      // ~9.3 km from Gross; ~1.4 km from Klein; ~1.4 km from Winzig; ~0.7 km from the A7 point; ~3 km from Klein (outside its 2 km)
      await c.query(
        `insert into fuel_stations (id, geom) values
           ('gross', ST_MakePoint(7.13, 50)::geography), ('klein', ST_MakePoint(9.02, 50)::geography),
           ('winzig', ST_MakePoint(10.02, 50)::geography), ('a7', ST_MakePoint(8.01, 52)::geography),
           ('aussen', ST_MakePoint(9.042, 50)::geography)`,
      );
      await c.query(
        `insert into fuel_prices (observed_at, station_id, product, price) values
           (now() - interval '3 hours', 'gross', 'e5', 1.7), (now() - interval '2 hours', 'gross', 'e5', 1.7), (now() - interval '1 hour', 'gross', 'e5', 1.7),
           (now() - interval '90 minutes', 'gross', 'diesel', 1.6),
           (now() - interval '30 hours', 'klein', 'e5', 1.7), (now() - interval '20 minutes', 'klein', 'e5', 1.7),
           (now() - interval '20 minutes', 'klein', 'e10', 1.6),
           (now() - interval '2 hours', 'a7', 'e5', 1.8), (now() - interval '100 minutes', 'a7', 'e5', 1.8),
           (now() - interval '2 hours', 'winzig', 'e5', 1.7), (now() - interval '1 hour', 'winzig', 'e5', 1.7),
           (now() - interval '2 hours', 'aussen', 'e5', 1.7), (now() - interval '1 hour', 'aussen', 'e5', 1.7)`,
      );
      const cadence = (days: number): Promise<{ median_gap_s: number | null; samples: number }> =>
        one(c, "select median_gap_s, samples from fuel_warm_cadence(1000, 2000, 20000, 1000, 1000, 3, $1)", [days]);
      expect(await cadence(1)).toEqual({ median_gap_s: 3600, samples: 3 });
      expect(await cadence(2)).toEqual({ median_gap_s: 3600, samples: 4 });
      expect(await one(c, "select median_gap_s, samples from fuel_warm_cadence(1000, 2000, 20000, 1000, 500, 3, 1)")).toEqual({ median_gap_s: 3600, samples: 2 });
    });
  });
});
