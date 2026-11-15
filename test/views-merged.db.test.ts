/**
 * The `_merged` views of the domain tables (#32), the trust ranking: one row
 * per entity (its match_key, else source|feed|external_id) among the open
 * rows, the most trusted source first, a source the registry does not know
 * last, then the newest observation, then source and external id; beside it
 * every open row's source and the count. Seeded in a rolled-back transaction
 * with the table's CHECKs dropped and session_replication_role = replica, so
 * the ranking is the one thing under test.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { DomainDb } from "./domain-db.js";
import { rows, requireDb, url } from "./schema-db.js";
import { insertRow } from "./seed-fill.js";

requireDb("the merged views");

type Seed = { ext: string; src: string; key: string | null; ago: number; closed?: true; set?: Record<string, string> };

/**
 * Entity k: high (90) beats low (10) and the unregistered one although both
 * are newer; the closed top (100) is no candidate. k2: one trust, the newer
 * wins. k3: one trust and one instant, the first external id wins. A row with
 * no match_key is an entity of its own.
 */
const SEEDS: readonly Seed[] = [
  { ext: "a", src: "src_low", key: "k", ago: 60 },
  { ext: "b", src: "src_high", key: "k", ago: 120 },
  { ext: "c", src: "src_top", key: "k", ago: 0, closed: true },
  { ext: "d", src: "src_unknown", key: "k", ago: 0 },
  { ext: "e1", src: "src_low", key: "k2", ago: 120 },
  { ext: "e2", src: "src_low", key: "k2", ago: 60 },
  { ext: "f2", src: "src_low", key: "k3", ago: 30 },
  { ext: "f1", src: "src_low", key: "k3", ago: 30 },
  { ext: "g", src: "src_low", key: null, ago: 30 },
];

const EXPECTED = [
  { entity_key: "k", external_id: "b", trust: 90, source_count: 3, sources: ["a", "b", "d"] },
  { entity_key: "k2", external_id: "e2", trust: 10, source_count: 2, sources: ["e1", "e2"] },
  { entity_key: "k3", external_id: "f1", trust: 10, source_count: 2, sources: ["f1", "f2"] },
  { entity_key: "src_low|f|g", external_id: "g", trust: 10, source_count: 1, sources: ["g"] },
];

describe.skipIf(url === undefined)("the merged views", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "merged");

  beforeAll(async () => {
    await t.make([
      ["src_low", "test", 10],
      ["src_high", "test", 90],
      ["src_top", "test", 100],
    ]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  const seed = async (c: pg.ClientBase, table: string, extra: readonly Seed[]): Promise<void> => {
    for (const ck of await rows<{ n: string }>(c, "select conname as n from pg_constraint where conrelid = $1::regclass and contype = 'c'", [table])) {
      await c.query(`alter table ${table} drop constraint "${ck.n}"`);
    }
    await c.query("set local session_replication_role = replica");
    for (const [i, s] of [...SEEDS, ...extra].entries()) {
      await insertRow(
        c,
        table,
        {
          source_id: `'${s.src}'`,
          feed: "'f'",
          external_id: `'${s.ext}'`,
          match_key: s.key === null ? "null" : `'${s.key}'`,
          observed_at: `timestamptz '2026-11-15 12:00Z' - interval '${String(s.ago)} minutes'`,
          closed_at: s.closed === true ? "now()" : "null",
          ...s.set,
        },
        101 + i,
        "id",
      );
    }
  };

  const merged = async (c: pg.ClientBase, view: string): Promise<unknown[]> =>
    (
      await rows<{ entity_key: string; external_id: string; trust: number | null; source_count: number; sources: { external_id: string }[] }>(
        c,
        `select entity_key, external_id, trust, source_count, sources from ${view} order by entity_key collate "C"`,
      )
    ).map((r) => ({ ...r, sources: r.sources.map((x) => x.external_id).sort() }));

  const check = async (name: string, extra: readonly Seed[] = [], more: readonly (typeof EXPECTED)[number][] = []): Promise<void> => {
    await t.planted(async (c) => {
      await seed(c, `domains.${name}`, extra);
      const want = [...EXPECTED, ...more].sort((x, y) => (x.entity_key < y.entity_key ? -1 : 1));
      expect(await merged(c, `domains.${name}_merged`)).toEqual(want);
    });
  };

  // a tie on trust and time: the recommendation that says more wins over the first external id
  it("domains.route_recommendations_merged: the most trusted open row per entity, then the newest, then the fuller, then the first id", () =>
    check(
      "route_recommendations",
      [
        { ext: "h1", src: "src_low", key: "k4", ago: 30 },
        { ext: "h2", src: "src_low", key: "k4", ago: 30, set: { recommendation: "'Umleitung U1'", severity: "'high'" } },
      ],
      [{ entity_key: "k4", external_id: "h2", trust: 10, source_count: 2, sources: ["h1", "h2"] }],
    ));
  it("domains.speed_cameras_merged: the most trusted open row per entity, then the newest, then the first id", () => check("speed_cameras"));
  it("domains.transit_agencies_odbl_merged: the most trusted open row per entity, then the newest, then the first id", () => check("transit_agencies_odbl"));
  it("domains.transit_routes_odbl_merged: the most trusted open row per entity, then the newest, then the first id", () => check("transit_routes_odbl"));
  it("domains.transit_service_dates_odbl_merged: the most trusted open row per entity, then the newest, then the first id", () => check("transit_service_dates_odbl"));
  it("domains.transit_stop_times_odbl_merged: the most trusted open row per entity, then the newest, then the first id", () => check("transit_stop_times_odbl"));
  it("domains.transit_stops_odbl_merged: the most trusted open row per entity, then the newest, then the first id", () => check("transit_stops_odbl"));
  it("domains.transit_trip_updates_odbl_merged: the most trusted open row per entity, then the newest, then the first id", () => check("transit_trip_updates_odbl"));
  it("domains.transit_trips_odbl_merged: the most trusted open row per entity, then the newest, then the first id", () => check("transit_trips_odbl"));
});
