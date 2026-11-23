/**
 * 0334 (viafrei-database#57): contract.occupancy_observation's SID name,
 * 'sid:' || facility_id, is an index key on every day partition, so a reader
 * asking for one facility by that name — the API's ParkingNear — probes each
 * partition once instead of reading it whole; the view's rows are its own.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { describe, expect, it } from "vitest";
import { partitionIndexName } from "./index-names.js";
import { migratedSuite, reapply } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0334 parking SID contract key", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0334 test did not run");
    });
  });
}

const DEF = "btree ((('sid:'::text || facility_id)), observed_at)";

/** The API's per-facility read (ParkingNear's lateral), for one facility name. */
const NEWEST = `select free_spaces, total_spaces, occupancy_status, observed_at, source_ref
  from contract.occupancy_observation o
 where o.facility_id = $1 and o.source_ref = any($2::text[]) and o.observed_at <= $3::timestamptz
 order by o.observed_at desc
 limit 1`;

describe.skipIf(url === undefined)("0334 parking_occupancy_sid contract key", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "sidkey");

  it("the parent index is valid and every day partition holds an attached index of the view's expression", async () => {
    const parent = await t.pool.query<{ def: string; valid: boolean }>(
      `select split_part(pg_get_indexdef(x.indexrelid), ' USING ', 2) as def, x.indisvalid as valid
         from pg_index x where x.indexrelid = 'public.parking_occupancy_sid_contract_key'::regclass`,
    );
    expect(parent.rows).toEqual([{ def: DEF, valid: true }]);
    const parts = await t.pool.query<{ parts: number; keyed: number }>(
      `select count(*)::int as parts,
              count(*) filter (where exists (
                select 1 from pg_index x join pg_inherits a on a.inhrelid = x.indexrelid
                 where x.indrelid = h.inhrelid and a.inhparent = 'public.parking_occupancy_sid_contract_key'::regclass and x.indisvalid))::int as keyed
         from pg_inherits h where h.inhparent = 'public.parking_occupancy_sid'::regclass`,
    );
    expect(parts.rows[0]!.parts).toBeGreaterThan(0);
    expect(parts.rows[0]!.keyed).toBe(parts.rows[0]!.parts);
  });

  // Three fixed days of their own, so the check does not depend on the clock: two full days of reports every 30
  // minutes for 200 facilities, and the first tick of the third, as production holds just after midnight UTC.
  const DAYS = ["2031-03-01", "2031-03-02", "2031-03-03"] as const;
  const FULL = ["parking_occupancy_sid_20310301", "parking_occupancy_sid_20310302"] as const;

  for (const at of ["2031-03-03T00:01:00Z", "2031-03-02T23:52:00Z"]) {
    it(`the API's newest-report read for one facility is an index probe of each full day partition, and answers the view's own row (asked at ${at})`, async () => {
      const c = await t.pool.connect();
      try {
        await c.query("begin");
        for (const [i, d] of DAYS.entries()) {
          const next = i + 1 < DAYS.length ? DAYS[i + 1]! : "2031-03-04";
          await c.query(`create table public.parking_occupancy_sid_${d.replaceAll("-", "")} partition of public.parking_occupancy_sid for values from ('${d}T00:00:00Z') to ('${next}T00:00:00Z')`);
        }
        await c.query(
          `insert into public.parking_occupancy_sid (observed_at, facility_id, source_feed, raw, spaces_free, spaces_total, status)
           select ts, f, 'truckpark_sid_dyn', '{}', (f + extract(minute from ts)::int) % 40, 40, 'free'
             from generate_series(1, 200) f,
                  generate_series(timestamptz '2031-03-01T00:00:00Z', timestamptz '2031-03-03T00:00:00Z', interval '30 minutes') ts`,
        );
        await c.query("analyze public.parking_occupancy_sid");
        const params = ["sid:17", ["truckpark_sid_dyn"], new Date(at)];
        const plan = (await c.query<{ "QUERY PLAN": string }>(`explain (costs off) ${NEWEST}`, params)).rows.map((r) => r["QUERY PLAN"]).join("\n");
        // every full day partition is probed by the name, none read whole
        for (const p of FULL) {
          expect(plan).not.toMatch(new RegExp(`Seq Scan on ${p} `));
          expect(plan).toMatch(new RegExp(`Index Scan on ${p}_\\S+\\n\\s+Index Cond: \\(\\(\\('sid:'::text \\|\\| \\(facility_id\\)::text\\) = 'sid:17'::text\\)`));
        }
        // a name the SID branch cannot hold finds nothing, through the index as well
        const other = (await c.query<{ "QUERY PLAN": string }>(`explain (costs off) ${NEWEST}`, ["p:17", ["truckpark_sid_dyn"], new Date(at)])).rows.map((r) => r["QUERY PLAN"]).join("\n");
        for (const p of FULL) expect(other).not.toMatch(new RegExp(`Seq Scan on ${p} `));
        const got = await c.query(NEWEST, params);
        // the same read with no index scan of any kind: a plan that cannot touch the new index
        const FENCED = `select free_spaces, total_spaces, occupancy_status, observed_at, source_ref
             from (select * from contract.occupancy_observation o where o.facility_id = $1 and o.source_ref = any($2::text[]) and o.observed_at <= $3::timestamptz offset 0) o
            order by o.observed_at desc limit 1`;
        await c.query("set local enable_indexscan = off");
        await c.query("set local enable_bitmapscan = off");
        await c.query("set local enable_indexonlyscan = off");
        const fencedPlan = (await c.query<{ "QUERY PLAN": string }>(`explain (costs off) ${FENCED}`, params)).rows.map((r) => r["QUERY PLAN"]).join("\n");
        expect(fencedPlan).not.toMatch(/expr_observed_at_idx|contract_key|Index/);
        const want = await c.query(FENCED, params);
        expect(got.rows).toHaveLength(1);
        expect(got.rows).toEqual(want.rows);
      } finally {
        await c.query("rollback");
        c.release();
      }
    });
  }

  it("re-applies where a part was made by hand: a partition's index built under another name is attached, a failed build rebuilt", async () => {
    const parts = (await t.pool.query<{ p: string }>("select inhrelid::regclass::text as p from pg_inherits where inhparent = 'public.parking_occupancy_sid'::regclass order by 1")).rows.map((r) => r.p);
    expect(parts.length).toBeGreaterThan(1);
    const [byHand, failed] = [parts[0]!, parts[1]!];
    // the whole index gone, one partition keyed by hand under its own name, another's build left INVALID
    await t.pool.query("drop index public.parking_occupancy_sid_contract_key");
    await t.pool.query(`create index by_hand_sid_key on ${byHand} (('sid:' || facility_id), observed_at)`);
    await t.pool.query(`create index failed_sid_key on ${failed} (('sid:' || facility_id), observed_at)`);
    await t.pool.query("update pg_index set indisvalid = false where indexrelid = 'public.failed_sid_key'::regclass");
    await reapply(t, service(), "0334_parking_occupancy_sid_contract_key.sql");
    const r = await t.pool.query<{ p: string; i: string }>(
      `select x.indrelid::regclass::text as p, x.indexrelid::regclass::text as i
         from pg_index x join pg_inherits a on a.inhrelid = x.indexrelid
        where a.inhparent = 'public.parking_occupancy_sid_contract_key'::regclass and x.indisvalid order by 1`,
    );
    expect(r.rows.map((x) => x.p)).toEqual(parts);
    expect(r.rows.find((x) => x.p === byHand)?.i).toBe("by_hand_sid_key");
    // the failed build and every other partition's index: PostgreSQL's own name for the parent's clone
    expect(r.rows.find((x) => x.p === failed)?.i).toBe(partitionIndexName(failed, "idx", ["expr", "observed_at"]));
    for (const x of r.rows.filter((y) => y.p !== byHand)) expect(x.i).toBe(partitionIndexName(x.p, "idx", ["expr", "observed_at"]));
    const left = await t.pool.query("select 1 from pg_class where relname = 'failed_sid_key'");
    expect(left.rows).toHaveLength(0);
    const valid = await t.pool.query<{ v: boolean }>("select indisvalid as v from pg_index where indexrelid = 'public.parking_occupancy_sid_contract_key'::regclass");
    expect(valid.rows).toEqual([{ v: true }]);
  });
});
