/**
 * 0351: each situation record's clock-free entry facts, stored at write time (road_events.entry_records).
 *
 *  - road_event_entry_records gives, per record in the publisher's order, exactly the columns the readers'
 *    record-at-a-moment fragment derives from the payload (compared here with that fragment's own select);
 *    no record is an empty array, never NULL;
 *  - road_events_fill_entry_static fills it on insert and on an update of payload, beside entry_static;
 *  - road_events_entry_records_backfill fills at most its batch of the unfilled rows, oldest first, then answers 0,
 *    through road_events_entry_records_unfilled;
 *  - road_events_live and road_events_current end with entry_records.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { describe, expect, it } from "vitest";
import { migratedSuite } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0351 entry records", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0351 test did not run");
    });
  });
}

const tx = (v: string): [{ "#text": string }] => [{ "#text": v }];

/** Record 0: a closure with listed closed lanes and a management type; record 1: lanes in use (numbered and not), a speed, both senses. */
const PAYLOAD = {
  situationRecord: [
    {
      validity: [{ validityTimeSpecification: [{ overallStartTime: tx("2026-11-06T00:00:00+01:00"), overallEndTime: tx("2026-11-07T00:00:00") }] }],
      impact: [{ numberOfLanesRestricted: tx("3"), originalNumberOfLanes: tx("3"), residualRoadWidth: tx("0"), impactExtension: [{ impactExtended: [{ closedLanes: [tx("lane1")[0], tx("lane2")[0]] }] }] }],
      roadOrCarriagewayOrLaneManagementType: tx("roadClosed"),
      groupOfLocations: [{ alertCLinear: [{ alertCDirection: [{ alertCDirectionCoded: tx("negative") }] }] }],
    },
    {
      validity: [{ validityTimeSpecification: [{ overallStartTime: tx("2026-11-03T10:00:00Z"), overallEndTime: tx("unreadable") }] }],
      impact: [{
        numberOfLanesRestricted: tx("1"), originalNumberOfLanes: tx("3"), residualRoadWidth: tx("6.5"),
        impactExtension: [{ impactExtended: [{ hardShoulderStatus: tx("closed"), laneRestriction: [{ lane: tx("lane1") }, { lane: tx("lane2") }, { lane: tx("hardShoulder") }] }] }],
      }],
      operatorActionExtension: [{ operatorActionExtended: [{ mainSpeedLimit: tx("60") }] }],
      groupOfLocations: [{ alertCLinear: [{ alertCDirection: [{ alertCDirectionCoded: tx("positive") }, { alertCDirectionCoded: tx("negative") }] }] }],
    },
  ],
};

/** The readers' per-record select (the application's record-at-a-moment fragment, its inner select), validity kept as text. */
const FRAGMENT = `select r.n,
         r.rec -> 'validity' -> 0 -> 'validityTimeSpecification' -> 0 -> 'overallStartTime' -> 0 ->> '#text' as ps,
         r.rec -> 'validity' -> 0 -> 'validityTimeSpecification' -> 0 -> 'overallEndTime' -> 0 ->> '#text' as pe,
         r.rec -> 'impact' -> 0 -> 'numberOfLanesRestricted' -> 0 ->> '#text' as lr,
         r.rec -> 'impact' -> 0 -> 'originalNumberOfLanes' -> 0 ->> '#text' as lt,
         nullif((select count(*) from jsonb_path_query(r.rec, '$.impact[0].impactExtension[0].impactExtended[0].laneRestriction[*].lane."#text"') l(v)
                  where l.v #>> '{}' ~ '^lane[0-9]+$'), 0)::int as lu,
         r.rec -> 'impact' -> 0 -> 'residualRoadWidth' -> 0 ->> '#text' as rw,
         r.rec -> 'impact' -> 0 -> 'impactExtension' -> 0 -> 'impactExtended' -> 0 -> 'hardShoulderStatus' -> 0 ->> '#text' as hs,
         r.rec -> 'operatorActionExtension' -> 0 -> 'operatorActionExtended' -> 0 -> 'mainSpeedLimit' -> 0 ->> '#text' as sl,
         jsonb_path_query_array(r.rec, '$.impact.**.closedLanes."#text"') as cl,
         jsonb_path_query_array(r.rec, '$.roadOrCarriagewayOrLaneManagementType."#text"') as mg,
         jsonb_path_query_array(r.rec, '$.groupOfLocations.**.alertCDirectionCoded."#text"') as se
    from jsonb_array_elements(case when jsonb_typeof($1::jsonb -> 'situationRecord') = 'array' then $1::jsonb -> 'situationRecord' else '[]'::jsonb end) with ordinality as r(rec, n)
   order by r.n`;

const STORED = `select x.* from jsonb_to_recordset(public.road_event_entry_records($1::jsonb))
  as x(n bigint, ps text, pe text, lr text, lt text, lu int, rw text, hs text, sl text, cl jsonb, mg jsonb, se jsonb)`;

describe.skipIf(url === undefined)("0351 each record's entry facts, stored at write time", () => {
  const { t } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "entryrec");
  const q = async <T extends object>(sql: string, args: unknown[] = []): Promise<T[]> => (await t.pool.query<T & Record<string, unknown>>(sql, args)).rows;
  const plant = (pub: string, payload: unknown): Promise<unknown> =>
    t.pool.query("insert into road_events (feed_key, source_id, publication_id, version, payload) values ('f', 's', $1, 1, $2::jsonb)", [pub, JSON.stringify(payload)]);
  const records = async (pub: string): Promise<unknown> => (await q<{ r: unknown }>("select entry_records r from road_events where publication_id = $1", [pub]))[0]?.r;

  it("road_event_entry_records is the readers' per-record select, record for record, and an empty array without records", async () => {
    const want = await q(FRAGMENT, [JSON.stringify(PAYLOAD)]);
    expect(want).toHaveLength(2);
    expect(await q(STORED, [JSON.stringify(PAYLOAD)])).toEqual(want);
    expect(want[1]).toMatchObject({ lu: 2, sl: "60", hs: "closed", pe: "unreadable" });
    for (const p of [{}, { situationRecord: {} }, { situationRecord: [] }, []]) {
      expect(await q<{ r: unknown }>("select public.road_event_entry_records($1::jsonb) r", [JSON.stringify(p)])).toEqual([{ r: [] }]);
    }
  });

  it("road_events_fill_entry_static fills it on insert and follows an update of payload; another update leaves it", async () => {
    await plant("e1", PAYLOAD);
    expect(await records("e1")).toEqual(await q<{ r: unknown }>("select public.road_event_entry_records($1::jsonb) r", [JSON.stringify(PAYLOAD)]).then((r) => r[0]?.r));
    expect(await q("select entry_static is not null s from road_events where publication_id = 'e1'")).toEqual([{ s: true }]);
    await t.pool.query("update road_events set payload = $1::jsonb where publication_id = 'e1'", [JSON.stringify({ situationRecord: [PAYLOAD.situationRecord[1]] })]);
    expect(await records("e1")).toHaveLength(1);
    await t.pool.query("update road_events set entry_records = '[\"kept\"]'::jsonb where publication_id = 'e1'");
    await t.pool.query("update road_events set version = 2 where publication_id = 'e1'");
    expect(await records("e1")).toEqual(["kept"]);
  });

  it("road_events_entry_records_backfill fills at most its batch, oldest first, then answers 0", async () => {
    await plant("b1", PAYLOAD);
    await plant("b2", {});
    await plant("b3", PAYLOAD);
    await t.pool.query("update road_events set entry_records = null");
    await t.pool.query("update road_events set entry_records = '[\"kept\"]'::jsonb where publication_id = 'b3'");
    const unfilled = async (): Promise<number> => (await q<{ n: number }>("select count(*)::int n from road_events where entry_records is null"))[0]!.n;
    const before = await unfilled();
    expect(before).toBeGreaterThanOrEqual(3);
    const oldest = (await q<{ p: string }>("select publication_id p from road_events where entry_records is null order by id limit 1"))[0]!.p;
    expect(await q("select public.road_events_entry_records_backfill(1) n")).toEqual([{ n: 1 }]);
    expect(await unfilled()).toBe(before - 1);
    expect(await records(oldest)).not.toBeNull();
    expect(await q("select public.road_events_entry_records_backfill(0) n")).toEqual([{ n: 0 }]);
    expect(await q("select public.road_events_entry_records_backfill(1000) n")).toEqual([{ n: before - 1 }]);
    expect(await q("select public.road_events_entry_records_backfill(1000) n")).toEqual([{ n: 0 }]);
    expect(await records("b1")).toHaveLength(2);
    expect(await records("b2")).toEqual([]);
    expect(await records("b3")).toEqual(["kept"]);
    expect(await q("select pg_get_indexdef('public.road_events_entry_records_unfilled'::regclass) d")).toEqual([
      { d: "CREATE INDEX road_events_entry_records_unfilled ON public.road_events USING btree (id) WHERE (entry_records IS NULL)" },
    ]);
  });

  it("road_events_entry_records_backfill skips a row a writer holds, and fills it once the writer is done", async () => {
    await plant("l1", PAYLOAD);
    await plant("l2", PAYLOAD);
    await t.pool.query("update road_events set entry_records = null where publication_id in ('l1', 'l2')");
    const writer = await t.pool.connect();
    try {
      await writer.query("begin");
      await writer.query("select 1 from road_events where publication_id = 'l1' for update");
      // A second session: the pool's other connection, while the writer's transaction holds l1.
      await t.pool.query("set lock_timeout = '2s'");
      const filled = (await q<{ n: number }>("select public.road_events_entry_records_backfill(1000) n"))[0]!.n;
      expect(filled).toBeGreaterThanOrEqual(1);
      expect(await records("l1")).toBeNull();
      expect(await records("l2")).toHaveLength(2);
      await writer.query("commit");
    } finally {
      writer.release();
    }
    expect(await q("select public.road_events_entry_records_backfill(1000) n")).toEqual([{ n: 1 }]);
    expect(await records("l1")).toHaveLength(2);
  });

  it("road_events_live and road_events_current end with entry_records, with their grants", async () => {
    const cols = async (rel: string): Promise<string[]> =>
      (await q<{ a: string }>("select attname a from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum", [rel])).map((r) => r.a);
    const base = await cols("public.road_events");
    expect(base.at(-1)).toBe("entry_records");
    expect(await cols("public.road_events_live")).toEqual(base);
    expect(await cols("public.road_events_current")).toEqual(base);
    expect(await q(`select has_table_privilege('viafrei_digest', 'public.road_events_live', 'select') d, has_table_privilege('viafrei_mcp', 'public.road_events_live', 'select') m`)).toEqual([{ d: true, m: true }]);
  });

});
