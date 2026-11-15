/**
 * Two loaders of the status console, by behaviour (#32): ops_rollup_usage_fold
 * folds the hourly MCP tool calls into Berlin days per tool and traffic class,
 * and search_console_weekly_load stores one Search Console week, never
 * letting an unread week overwrite a read one.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { DomainDb } from "./domain-db.js";
import { one, refused, requireDb, rows, url } from "./schema-db.js";

requireDb("the rollup loaders");

describe.skipIf(url === undefined)("the rollup loaders", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "rollup_ld");

  beforeAll(async () => {
    await t.make([]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  it("ops_rollup_usage_fold: the hourly tool calls of the Berlin days asked, per tool (else other) and class, errors without the caller's own; a refold replaces; no range is refused", async () => {
    await t.planted(async (c) => {
      const usage = (at: string, tool: string, client: string, extra: Record<string, string | number> = {}, period = "hour", rpc = "tools/call"): Promise<pg.QueryResult> => {
        const cols = { period: `'${period}'`, period_start: `'${at}'`, door: "'streamable'", rpc: `'${rpc}'`, tool: `'${tool}'`, client: `'${client}'`, requests: 1, ...extra };
        return c.query(`insert into mcp_usage (${Object.keys(cols).join(", ")}) values (${Object.values(cols).join(", ")})`);
      };
      // 2026-11-14 in Berlin (CET) is [13 23:00Z, 14 23:00Z)
      await usage("2026-11-13T23:00Z", "find_fuel", "claude-ai", { requests: 10, tool_errors: 5, tool_error_invalid_input: 2, tool_error_not_found: 1, tool_error_out_of_coverage: 1, server_errors: 2, ms_le_100: 7, ms_gt_10000: 3 });
      await usage("2026-11-14T22:00Z", "find_fuel", "chatgpt", { requests: 5, tool_errors: 1, tool_error_invalid_input: 3, ms_le_100: 1 });
      await usage("2026-11-14T12:00Z", "", "viafrei-smoke", { requests: 2 });
      await usage("2026-11-14T12:00Z", "find_fuel", "unknown", { requests: 4, server_errors: 1 });
      await usage("2026-11-14T23:00Z", "find_fuel", "claude-ai", { requests: 100 });
      await usage("2026-11-13T22:00Z", "find_fuel", "claude-ai", { requests: 100 });
      await usage("2026-11-14T12:00Z", "find_fuel", "claude-ai", { requests: 100 }, "hour", "tools/list");
      await usage("2026-11-14T00:00Z", "find_fuel", "claude-ai", { requests: 100 }, "day");
      const folded = async (): Promise<string[]> =>
        (await rows<{ x: string }>(c, "select day || ' ' || tool || ' ' || class || ' ' || calls || ' ' || errors || ' ' || ms_le_100 || ' ' || ms_gt_10000 as x from ops_rollup_usage")).map((x) => x.x).sort();
      expect((await one<{ n: number }>(c, "select ops_rollup_usage_fold('2026-11-14', '2026-11-14') as n")).n).toBe(3);
      expect(await folded()).toEqual(["2026-11-14 find_fuel real 15 3 8 3", "2026-11-14 find_fuel scanners 4 1 0 0", "2026-11-14 other own 2 0 0 0"]);
      await c.query("update mcp_usage set requests = 20 where client = 'claude-ai' and period_start = '2026-11-13T23:00Z'");
      expect((await one<{ n: number }>(c, "select ops_rollup_usage_fold('2026-11-14', '2026-11-14') as n")).n).toBe(3);
      expect(await folded()).toContain("2026-11-14 find_fuel real 25 3 8 3");
      expect((await one<{ n: number }>(c, "select ops_rollup_usage_fold('2026-11-13', '2026-11-15') as n")).n).toBe(5);
      expect((await refused(c, "select ops_rollup_usage_fold('2026-11-15', '2026-11-14')"))?.message).toMatch(/non-empty range/);
      expect((await refused(c, "select ops_rollup_usage_fold(null, '2026-11-14')"))?.message).toMatch(/non-empty range/);
    });
  });

  it("search_console_weekly_load: a read week replaces the week and its parts; an unread one is stored but never over a read one, which only notes the try; no week or state is refused", async () => {
    await t.planted(async (c) => {
      const load = async (doc: unknown): Promise<string> => (await one<{ r: string }>(c, "select search_console_weekly_load($1::jsonb) as r", [JSON.stringify(doc)])).r;
      const week = async (w: string): Promise<unknown> =>
        one(c, "select state, impressions::int, clicks::int, position::text, shown_not_clicked, legacy_impressions::int, tried_at < now() - interval '1 day' as tried_long_ago from search_console_weekly where week = $1", [w]);
      const parts = async (w: string): Promise<string[]> =>
        (await rows<{ x: string }>(c, "select dimension || ':' || key || ' ' || coalesce(rows::text, '-') || ' ' || impressions || ' ' || clicks || ' ' || position as x from search_console_weekly_parts where week = $1", [w])).map((x) => x.x).sort();
      const read = {
        week: "2026-11-09",
        state: "read",
        impressions: 900,
        clicks: 30,
        position: 7.25,
        shownNotClicked: 12,
        legacyImpressions: 1000,
        parts: [
          { dimension: "device", key: "mobile", impressions: 600, clicks: 20, position: 6.5 },
          { dimension: "position_bucket", key: "1-3", rows: 4, impressions: 100, clicks: 10, position: 2 },
        ],
      };
      expect(await load(read)).toBe("read parts=2");
      expect(await week("2026-11-09")).toEqual({ state: "read", impressions: 900, clicks: 30, position: "7.25", shown_not_clicked: 12, legacy_impressions: 1000, tried_long_ago: false });
      expect(await parts("2026-11-09")).toEqual(["device:mobile - 600 20 6.50", "position_bucket:1-3 4 100 10 2.00"]);
      await c.query("update search_console_weekly set tried_at = now() - interval '2 days'");
      expect(await load({ week: "2026-11-09", state: "unread" })).toBe("unread parts=0 kept=read");
      expect(await week("2026-11-09")).toMatchObject({ state: "read", impressions: 900, tried_long_ago: false });
      expect(await parts("2026-11-09")).toHaveLength(2);
      expect(await load({ ...read, impressions: 950, parts: [{ dimension: "page_type", key: "road", impressions: 50, clicks: 5, position: 3 }] })).toBe("read parts=1");
      expect(await parts("2026-11-09")).toEqual(["page_type:road - 50 5 3.00"]);
      expect(await week("2026-11-09")).toMatchObject({ impressions: 950 });
      expect(await load({ week: "2026-11-02", state: "unread", parts: read.parts })).toBe("unread parts=0");
      expect(await week("2026-11-02")).toEqual({ state: "unread", impressions: null, clicks: null, position: null, shown_not_clicked: null, legacy_impressions: null, tried_long_ago: false });
      expect(await parts("2026-11-02")).toEqual([]);
      expect(await load({ week: "2026-11-02", state: "unread" })).toBe("unread parts=0");
      expect((await refused(c, "select search_console_weekly_load('{\"state\": \"read\"}')"))?.message).toMatch(/needs week and state/);
      expect((await refused(c, "select search_console_weekly_load('{\"week\": \"2026-11-09\"}')"))?.message).toMatch(/needs week and state/);
    });
  });
});
