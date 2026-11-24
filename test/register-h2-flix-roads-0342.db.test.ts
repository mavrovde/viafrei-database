/**
 * 0342: h2_mobility answers for energy, and thirteen feeds whose catalogue
 * licence id is a licence code resolve to a register row.
 *
 *  - every contract source, read as the API's licence gate reads it (domain,
 *    register row, use classes), before 0342 (0312's two views and no new
 *    register rows, in a rolled-back transaction) and after: h2_mobility moves
 *    from roads to energy, the thirteen gain their register row and use
 *    classes, and nothing else changes, not even the set of sources;
 *  - the six new register rows and flix_transit carry their licence's terms:
 *    CC0 and dl-de/by-2-0 all three classes and no share-alike, ODbL all
 *    three with share-alike on the database, exactly as the OSM rows;
 *  - the file applied again is a no-op.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";
import { migratedSuite } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0342 register: h2_mobility, flix and road feeds", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0342 test did not run");
    });
  });
}

const FILE = "0342_register_h2_flix_roads.sql";
const ALL = ["consumer", "non_commercial", "commercial"];
const NEW_ROWS = [
  "bochum_baustellen",
  "rostock_baustellen",
  "bonn_messorte",
  "norderstedt_baustellen",
  "hannover_routenempfehlungen",
  "stuttgart_strategisches_routing",
];

/** The feeds as production's feed_catalog holds them (licence id and label), and a few that already resolved. */
const FEEDS: readonly (readonly [string, string, string])[] = [
  ["h2_mobility", "mobilithek_h2_stations", "CC BY 4.0"],
  ...["agencies", "stops", "routes", "trips", "stop-times", "service-dates", "trip-updates"].map(
    (t) => [`flix-${t}`, "odbl-1.0", "Open Database License 1.0 (ODbL 1.0)"] as const,
  ),
  ["bochum-baustellen", "cc0-1.0", "Creative Commons Zero 1.0 Universal (CC0 1.0)"],
  ["rostock-baustellen", "cc0-1.0", "Creative Commons Zero 1.0 Universal (CC0 1.0)"],
  ["bonn-messorte", "cc0-1.0", "CC0 1.0"],
  ["norderstedt-baustellen", "dl-de-by-2.0", "Datenlizenz Deutschland – Namensnennung – Version 2.0"],
  ["hannover-routenempfehlungen", "odbl-1.0", "Open Database License 1.0"],
  ["stuttgart-strategisches-routing", "dl-de-by-2.0", "Datenlizenz Deutschland – Namensnennung – Version 2.0"],
  ["delfi_rt_tu", "delfi_rt_tu", "CC BY-SA"],
  ["afir_enbw_stat", "afir_enbw", "AFIR Art. 20, keine Lizenz angegeben"],
  ["mobilithek_bab_messages", "autobahn", "open data (Autobahn GmbH)"],
  ["other-baustellen", "cc0-1.0", "CC0 1.0"],
];

/** Each family the gate reads: its domain, register row and use classes, as viafrei-api's sourceCTE computes them. */
const GATE = `select s.source_ref, d.domain, s.register_id,
       case when coalesce(k.display_class, 'open') = 'open' then coalesce(g.use_classes, '{}')
            else array(select u.u from unnest(coalesce(g.use_classes, '{}')) u(u) where u.u = 'consumer') end as use_classes
  from public.contract_sources s
  left join public.source_register g on g.source_id = s.register_id
  left join lateral (select d.domain from public.contract_source_domains d where s.source_ref ~ d.pattern order by d.priority limit 1) d on true
  left join lateral (select k.excluded, k.display_class from public.contract_source_rules k where s.source_ref ~ k.pattern order by k.priority limit 1) k on true
 where not coalesce(k.excluded, false) and coalesce(s.licence_code, '') !~* '^pending'
 order by 1`;

interface Family {
  source_ref: string;
  domain: string;
  register_id: string | null;
  use_classes: string[];
}

/** 0312's create view statement of `view`, as create or replace. */
function view0312(view: string): string {
  const text = readFileSync(join(REPO, "db", "migrations", "0312_contract_mapping.sql"), "utf8");
  const m = new RegExp(`create view public\\.${view} as\\n[\\s\\S]*?;\\n`).exec(text);
  if (m === null) throw new Error(`0312 has no create view public.${view}`);
  return m[0].replace(/^create view/, "create or replace view");
}

async function gate(c: pg.Pool | pg.PoolClient): Promise<Family[]> {
  return (await c.query<Family>(GATE)).rows;
}

describe.skipIf(url === undefined)("0342 register: h2_mobility, flix and road feeds", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "reg0342");

  async function seed(): Promise<void> {
    for (const [key, id, label] of FEEDS) {
      await t.pool.query(
        `insert into public.feed_catalog (feed_key, provider, display_name, licence_id, licence_label, attribution)
         values ($1, 'test', $1, $2, $3, 'Test: ' || $1) on conflict do nothing`,
        [key, id, label],
      );
    }
  }

  /** The gate's families as 0312 left them: its two views, no 0342 register rows, in a transaction rolled back. */
  async function before(): Promise<Family[]> {
    const c = await t.pool.connect();
    try {
      await c.query("begin");
      await c.query(view0312("contract_source_domains"));
      await c.query(view0312("contract_sources"));
      await c.query("delete from public.source_register where source_id = any($1)", [NEW_ROWS]);
      return await gate(c);
    } finally {
      await c.query("rollback");
      c.release();
    }
  }

  it("h2_mobility moves to energy, the thirteen gain their register row, nothing else changes", async () => {
    await seed();
    const was = new Map((await before()).map((f) => [f.source_ref, f]));
    const now = new Map((await gate(t.pool)).map((f) => [f.source_ref, f]));
    expect([...now.keys()]).toEqual([...was.keys()]);
    const byRef = (a: { source_ref: string }, b: { source_ref: string }): number => (a.source_ref < b.source_ref ? -1 : 1);
    const changed = [...now.values()].filter((f) => JSON.stringify(f) !== JSON.stringify(was.get(f.source_ref))).sort(byRef);
    const reg = (k: string): string => {
      if (k.startsWith("flix-")) return "flix_transit";
      return k === "h2_mobility" ? "mobilithek_h2_stations" : k.replaceAll("-", "_");
    };
    expect(changed).toEqual(
      FEEDS.filter(([k]) => k === "h2_mobility" || k.startsWith("flix-") || (NEW_ROWS.includes(k.replaceAll("-", "_"))))
        .map(([k]) => ({
          source_ref: k,
          domain: k === "h2_mobility" ? "energy" : k.startsWith("flix-") ? "transit" : "roads",
          register_id: reg(k),
          use_classes: ALL,
        }))
        .sort(byRef),
    );
    // The before side really was the gap: h2_mobility on roads, the thirteen unreviewed.
    expect(was.get("h2_mobility")?.domain).toBe("roads");
    expect(changed.filter((f) => f.source_ref !== "h2_mobility").map((f) => was.get(f.source_ref)?.use_classes)).toEqual(Array(13).fill([]));
    // A feed with a licence code no row names stays unreviewed; a new row is no register-only source of its own.
    expect(now.get("other-baustellen")?.use_classes).toEqual([]);
    for (const id of NEW_ROWS) expect(now.has(id), id).toBe(false);
    expect(now.get("flix_transit")).toEqual(was.get("flix_transit"));
  });

  it("the register rows carry their licence's terms, ODbL exactly as the OSM rows", async () => {
    const { rows } = await t.pool.query<{
      source_id: string;
      licence_label: string;
      share_alike: boolean;
      share_alike_database: boolean;
      use_classes: string[];
      consumer_answers_only: boolean;
      no_redistribution: boolean;
      source_url: string;
    }>(
      `select source_id, licence_label, share_alike, share_alike_database, use_classes, consumer_answers_only, no_redistribution, source_url
         from public.source_register where source_id = any($1) order by 1`,
      [[...NEW_ROWS, "flix_transit", "osm"]],
    );
    const terms = rows.map((r) => [r.source_id, r.licence_label, r.share_alike, r.share_alike_database, r.use_classes, r.consumer_answers_only, r.no_redistribution]);
    expect(terms).toEqual([
      ["bochum_baustellen", "CC0 1.0", false, false, ALL, false, false],
      ["bonn_messorte", "CC0 1.0", false, false, ALL, false, false],
      ["flix_transit", "ODbL 1.0", true, true, ALL, false, false],
      ["hannover_routenempfehlungen", "ODbL 1.0", true, true, ALL, false, false],
      ["norderstedt_baustellen", "dl-de/by-2-0", false, false, ALL, false, false],
      ["osm", "ODbL 1.0", true, true, ALL, false, false],
      ["rostock_baustellen", "CC0 1.0", false, false, ALL, false, false],
      ["stuttgart_strategisches_routing", "dl-de/by-2-0", false, false, ALL, false, false],
    ]);
  });

  it("the file applied again is a no-op", async () => {
    const families = await gate(t.pool);
    const register = (await t.pool.query<{ n: string }>("select count(*) as n from public.source_register")).rows[0]?.n;
    await t.pool.query("delete from schema_migrations where version = 342");
    const run = await service().migrate("cli");
    expect(run.ok, run.lines.join("\n")).toBe(true);
    expect(run.lines.filter((l) => l.startsWith("applying")).map((l) => l.split(" ")[1])).toEqual([FILE]);
    expect(await gate(t.pool)).toEqual(families);
    expect((await t.pool.query<{ n: string }>("select count(*) as n from public.source_register")).rows[0]?.n).toBe(register);
  });
});
