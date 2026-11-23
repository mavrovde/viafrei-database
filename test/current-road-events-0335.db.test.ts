/**
 * 0335: the two gaps 0330 and 0332 left.
 *
 *  - road_events_current names road_events_live's columns one by one, so the
 *    entry_static 0330 appended to road_events_live never reached it; after
 *    0335 it is road_events_live's columns, in their order, over the same rows;
 *  - viafrei_mcp may read traffic_count_sites_live (0332 granted it to the
 *    digest only), and still not the table under it.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainDb } from "./domain-db.js";
import { one, refused, requireDb, rows, url } from "./schema-db.js";

requireDb("0335 current road events and the MCP counting sites");

const cols = `select string_agg(attname, ',' order by attnum) as c from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped`;
const active = { situationRecord: [{ validity: [{ validityStatus: [{ "#text": "active" }] }] }] };

describe.skipIf(url === undefined)("0335 current road events and the MCP counting sites", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "rec335");

  beforeAll(async () => {
    await t.make([]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  it("road_events_current is road_events_live's columns, in its order, entry_static too, over the same rows", async () => {
    await t.planted(async (c) => {
      const live = (await one<{ c: string }>(c, cols, ["public.road_events_live"])).c;
      expect(live.split(",")).toContain("entry_static");
      expect((await one<{ c: string }>(c, cols, ["public.road_events_current"])).c).toBe(live);
      await c.query(
        `insert into road_events (feed_key, source_id, publication_id, version, payload) values ('f', 's', 'open', 1, $1::jsonb), ('f', 's', 'shut', 1, $1::jsonb)`,
        [JSON.stringify(active)],
      );
      await c.query("update road_events set closed_at = now() where publication_id = 'shut'");
      const cur = await rows<{ r: string }>(c, "select to_jsonb(e)::text as r from road_events_current e order by id");
      const want = await rows<{ r: string }>(c, "select to_jsonb(e)::text as r from road_events_live e where publication_id = 'open' order by id");
      expect(cur).toEqual(want);
      expect(cur).toHaveLength(1);
    });
  });

  it("viafrei_mcp reads traffic_count_sites_live, and not traffic_count_sites", async () => {
    await t.planted(async (c) => {
      await c.query("set local role viafrei_mcp");
      expect(await rows(c, "select id, section_key, geom from traffic_count_sites_live limit 1")).toEqual([]);
      expect((await refused(c, "select 1 from traffic_count_sites limit 1"))?.code).toBe("42501");
    });
  });
});
