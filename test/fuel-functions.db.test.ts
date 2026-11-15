/**
 * The fuel station labels and the price outliers, by behaviour (#32):
 * fuel_station_land and fuel_station_town_places from the BKG gazetteer,
 * the fuel_stations_land trigger that sets both, fuel_stations_relabel_land,
 * and fuel_price_outliers' band and jump.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { DomainDb } from "./domain-db.js";
import { one, requireDb, rows, url } from "./schema-db.js";

requireDb("the fuel functions");

/** Cities ~1.1 km apart along a parallel, one closed, one from another source, and a district nearest of all to 7.0012 E. */
const PLACES = `
  insert into gazetteer_places (kind, name, name_norm, admin_code, geom, source_id, external_id, closed_at) values
    ('city', 'Eins', 'eins', '05315000', ST_MakePoint(7.000, 50)::geography, 'bkg_gvisys', 'e1', null),
    ('city', 'Zwei', 'zwei', '07111000', ST_MakePoint(7.015, 50)::geography, 'bkg_gvisys', 'e2', null),
    ('city', 'Zu', 'zu', '09162000', ST_MakePoint(7.001, 50)::geography, 'bkg_gvisys', 'e3', now()),
    ('city', 'Fremd', 'fremd', '10041000', ST_MakePoint(7.002, 50)::geography, 'geonames', 'e4', null),
    ('district', 'Kreis', 'kreis', '11000000', ST_MakePoint(7.0011, 50)::geography, 'bkg_gvisys', 'e5', null),
    ('city', 'Weit', 'weit', '12054000', ST_MakePoint(7.400, 50)::geography, 'bkg_gvisys', 'e6', null)`;

describe.skipIf(url === undefined)("the fuel functions", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "fuel_fn");

  beforeAll(async () => {
    await t.make([]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  const at = (c: pg.ClientBase, lon: number): Promise<{ land: string | null; towns: { ags: string; name: string }[] | null }> =>
    one(c, "select fuel_station_land(ST_MakePoint($1, 50)::geography) as land, fuel_station_town_places(ST_MakePoint($1, 50)::geography) as towns", [lon]);

  it("the Land is the two-digit prefix of the nearest open BKG city; the towns are up to five such cities within 20 km, nearest first; no point is null", async () => {
    await t.planted(async (c) => {
      await c.query(PLACES);
      expect(await at(c, 7.0012)).toEqual({ land: "05", towns: [{ ags: "05315000", name: "Eins" }, { ags: "07111000", name: "Zwei" }] });
      expect(await at(c, 7.014)).toMatchObject({ land: "07", towns: [{ ags: "07111000", name: "Zwei" }, { ags: "05315000", name: "Eins" }] });
      // 7.4 E is ~27 km from both near cities and ~0 from Weit: Weit alone is in reach
      expect(await at(c, 7.4)).toEqual({ land: "12", towns: [{ ags: "12054000", name: "Weit" }] });
      expect(await at(c, 7.7)).toEqual({ land: "12", towns: [] });
      expect(await one(c, "select fuel_station_land(null) as land, fuel_station_town_places(null) as towns")).toEqual({ land: null, towns: null });
    });
  });

  it("at most five towns", async () => {
    await t.planted(async (c) => {
      await c.query(
        "insert into gazetteer_places (kind, name, name_norm, admin_code, geom, source_id, external_id) select 'city', 'C' || i, 'c' || i, '0100000' || i, ST_MakePoint(7 + i * 0.001, 50)::geography, 'bkg_gvisys', 'c' || i from generate_series(1, 7) i",
      );
      expect(((await at(c, 7)).towns ?? []).map((x) => x.name)).toEqual(["C1", "C2", "C3", "C4", "C5"]);
    });
  });

  it("the land trigger sets both on insert and on a moved station; relabel brings every station in line with the gazetteer and counts the changed", async () => {
    await t.planted(async (c) => {
      await c.query(PLACES);
      await c.query("insert into fuel_stations (id, geom) values ('a', ST_MakePoint(7.0012, 50)::geography), ('b', ST_MakePoint(7.4, 50)::geography)");
      const read = async (): Promise<string[]> =>
        (await rows<{ x: string }>(c, "select id || ' ' || coalesce(land, '-') || ' ' || jsonb_array_length(coalesce(town_places, '[]')) as x from fuel_stations order by id")).map((x) => x.x);
      expect(await read()).toEqual(["a 05 2", "b 12 1"]);
      await c.query("update fuel_stations set geom = ST_MakePoint(7.014, 50)::geography where id = 'a'");
      expect(await read()).toEqual(["a 07 2", "b 12 1"]);
      await c.query("update gazetteer_places set closed_at = now() where name = 'Weit'");
      expect((await one<{ n: number }>(c, "select fuel_stations_relabel_land() as n")).n).toBe(1);
      expect(await read()).toEqual(["a 07 2", "b 07 0"]);
      expect((await one<{ n: number }>(c, "select fuel_stations_relabel_land() as n")).n).toBe(0);
      // a new town near a and in its Land changes a's towns alone
      await c.query("insert into gazetteer_places (kind, name, name_norm, admin_code, geom, source_id, external_id) values ('city', 'Neu', 'neu', '07222000', ST_MakePoint(7.05, 50)::geography, 'bkg_gvisys', 'e7')");
      expect((await one<{ n: number }>(c, "select fuel_stations_relabel_land() as n")).n).toBe(1);
      expect(await read()).toEqual(["a 07 3", "b 07 0"]);
    });
  });

  it("fuel_price_outliers: a price outside the band, or a jump over the share from the station's previous price of the product, within the window", async () => {
    await t.planted(async (c) => {
      await c.query(
        `insert into fuel_prices (observed_at, station_id, product, price) values
           (now() - interval '30 hours', 's1', 'e5', 1.500), (now() - interval '2 hours', 's1', 'e5', 1.800),
           (now() - interval '1 hour', 's1', 'e5', 1.850), (now() - interval '1 hour', 's1', 'diesel', 0.500),
           (now() - interval '50 minutes', 's2', 'e5', 1.700), (now() - interval '40 minutes', 's2', 'e5', 2.600),
           (now() - interval '30 hours', 's3', 'e5', 9.000), (now() - interval '10 minutes', 's4', 'e5', 2.700)`,
      );
      const r = await rows<{ x: string }>(c, "select station_id || ' ' || product || ' ' || price || ' ' || coalesce(prev_price::text, '-') || ' ' || kind as x from fuel_price_outliers(0.800, 2.500, 0.15)");
      expect(r.map((x) => x.x)).toEqual(["s4 e5 2.700 - band", "s2 e5 2.600 1.700 band", "s1 diesel 0.500 - band", "s1 e5 1.800 1.500 jump"]);
      expect(await rows(c, "select station_id from fuel_price_outliers(0.800, 2.500, 0.15, interval '30 minutes')")).toEqual([{ station_id: "s4" }]);
    });
  });
});
