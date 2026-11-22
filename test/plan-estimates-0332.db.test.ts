/**
 * 0332: the planner's estimates and the API's lorry read.
 *
 *  - the normalised EVSE id has statistics of its own: an equality join on it
 *    is estimated from them, not from the 0.5 % default a partial index's
 *    expression falls back to;
 *  - contract.lorry_rule's distance read, written as the API writes it
 *    (geometry::geography), is answered through an index on every lorry table;
 *  - the SIRI ET tick tables keep no (stop_ref, observed_at) index, on a day's
 *    partition made after the migration either.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { describe, expect, it } from "vitest";
import { migratedSuite } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0332 plan estimates", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0332 test did not run");
    });
  });
}

/** The top node's estimated rows of a plan. */
const estimate = (plan: readonly { "QUERY PLAN": string }[]): number => Number(/rows=(\d+)/.exec(plan[0]!["QUERY PLAN"])![1]);

describe.skipIf(url === undefined)("0332 plan estimates and the lorry read", () => {
  const { t } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "planest");

  it("estimates an equality on the normalised EVSE id from its own statistics (charging_points_evse_norm_expr)", async () => {
    const c = await t.pool.connect();
    try {
      await c.query("begin");
      await c.query("insert into charging_sites (source_feed, site_id, geom) select 'f', 's' || g, ST_SetSRID(ST_MakePoint(13.4, 52.5), 4326)::geography from generate_series(1, 200) g");
      // 20 000 points: a third with no EVSE id, every other one its own
      await c.query(
        `insert into charging_points (source_feed, point_key, site_id, geom, evse_id)
         select 'f', 'p' || g, 's' || (1 + g % 200), ST_SetSRID(ST_MakePoint(13.4, 52.5), 4326)::geography,
                case when g % 3 = 0 then null else 'DE*ABC*E' || g end
           from generate_series(1, 20000) g`,
      );
      await c.query("analyze charging_points");
      const plan = await c.query<{ "QUERY PLAN": string }>(
        `explain select 1 from charging_points a join charging_points b
            on upper(translate(b.evse_id, '*-', '')) = upper(translate(a.evse_id, '*-', ''))
         where a.site_id = 's7'`,
      );
      // about 100 points of s7, each matching itself: far below the default's 0.5 % of 20 000 per point
      expect(estimate(plan.rows)).toBeLessThan(1_000);
      const objects = await c.query<{ stxname: string }>("select stxname from pg_statistic_ext where stxname like 'charging_%' order by 1");
      expect(objects.rows.map((r) => r.stxname)).toEqual(["charging_points_evse_norm_expr", "charging_points_publishable", "charging_sites_publishable"]);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("answers contract.lorry_rule's distance read, as the API writes it, through an index on each lorry table", async () => {
    const c = await t.pool.connect();
    try {
      await c.query("begin");
      await c.query("set local enable_seqscan = off");
      // the tables are empty here, so the planner would as soon walk any other open-rows index with the distance as a
      // filter; without them, the read is answered by the contract index's condition or not at all
      await c.query(
        `do $$ declare r record; begin
           for r in select i.relname from pg_class i join pg_index x on x.indexrelid = i.oid join pg_class t on t.oid = x.indrelid
                     where t.relname in ('lorry_long_network', 'lorry_sevas', 'lorry_ivm', 'lorry_hb', 'lorry_city')
                       and i.relname like '%_open' loop
             execute format('drop index public.%I', r.relname);
           end loop; end $$`,
      );
      const plan = await c.query<{ "QUERY PLAN": string }>(
        "explain select rule_id from contract.lorry_rule where st_dwithin(geometry::geography, st_point(6.96, 50.94)::geography, 2000)",
      );
      const text = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
      for (const table of ["lorry_long_network", "lorry_sevas", "lorry_ivm", "lorry_hb", "lorry_city"]) {
        expect(text, table).toMatch(new RegExp(`Index Scan using ${table}_contract_geography on ${table} [^\\n]*\\n\\s+Index Cond: \\(\\(\\(geom\\)::geometry\\)::geography && _st_expand`));
        expect(text, table).not.toMatch(new RegExp(`Seq Scan on ${table}\\b`));
      }
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("keeps no (stop_ref, observed_at) index on the SIRI ET tick tables, on a partition made after it either", async () => {
    const c = await t.pool.connect();
    try {
      await c.query("begin");
      await c.query("create table public.delfi_siri_et_calls_20991231 partition of public.delfi_siri_et_calls for values from ('2099-12-31') to ('2100-01-01')");
      const left = await c.query<{ indexrelid: string }>(
        `select i.indexrelid::regclass::text as indexrelid
           from pg_index i join pg_class t on t.oid = i.indrelid
          where t.relname ~ '^(delfi|vbn)_siri_et_calls(_\\d{8})?$'
            and pg_get_indexdef(i.indexrelid) like '%(stop_ref, observed_at)%'`,
      );
      expect(left.rows).toEqual([]);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});
