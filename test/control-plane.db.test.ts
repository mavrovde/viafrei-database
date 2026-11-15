/**
 * The admission control plane (schema control) against a real catalogue:
 * publish_terms, admit and every outcome it decides, hold, want, release,
 * set_budget and its refusals, fit_shares, the deferred shape triggers, the
 * audit and its append-only ledger, and the hourly rollup with its retention.
 * Every test runs as the owner in a transaction that is rolled back; the
 * deferred shape triggers are fired with SET CONSTRAINTS ALL IMMEDIATE.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DomainDb } from "./domain-db.js";
import { one, refused, requireDb, rows, url, type Queryable } from "./schema-db.js";

requireDb("the control plane");

const TERMS = {
  callers: [
    { caller: "wk", process: "worker", person: false, purpose: "the background worker" },
    { caller: "tl", process: "mcp", person: true, purpose: "a person asks through a tool" },
    { caller: "cl", process: "cli", person: false, purpose: "the operator by hand" },
    { caller: "lone", process: "worker", person: false, purpose: "a caller without a share" },
  ],
  budgets: [
    { budget_key: "plain", window_s: 3600, licence_max: 10, licence_source: "test terms, plain" },
    { budget_key: "spaced", window_s: 3600, licence_max: 60, licence_source: "test terms, spaced", spacing_licence_ms: 60000, hold_s: 300 },
    { budget_key: "bursty", window_s: 3600, licence_max: 100, licence_source: "test terms, bursty", burst_window_s: 60, burst_licence_max: 3 },
  ],
  providers: [
    { provider: "p_plain", budget_key: "plain", min_interval_ms: 1, max_concurrent: 1 },
    { provider: "p_spaced", budget_key: "spaced", min_interval_ms: 1, max_concurrent: 1 },
    { provider: "p_bursty", budget_key: "bursty", min_interval_ms: 1, max_concurrent: 1 },
  ],
  shares: [
    { budget_key: "plain", caller: "wk", floor: 1, cap: 6 },
    { budget_key: "plain", caller: "tl", floor: 2, cap: 7 },
    { budget_key: "plain", caller: "cl", floor: 2, cap: 7 },
    { budget_key: "spaced", caller: "wk", floor: 1, cap: 30 },
    { budget_key: "spaced", caller: "tl", floor: 2, cap: 30 },
    { budget_key: "bursty", caller: "wk", floor: 1, cap: 50 },
    { budget_key: "bursty", caller: "cl", floor: 1, cap: 50 },
  ],
};

type Admit = { admitted: boolean; outcome: string; token: string | null; wait_ms: number | null };
const admit = (c: pg.ClientBase, provider: string, caller: string): Promise<Admit> =>
  one<Admit>(c, "select admitted, outcome, token, wait_ms from control.admit($1, $2, 'test')", [provider, caller]);
const outcomes = async (c: pg.ClientBase, provider: string, caller: string, n: number): Promise<string[]> => {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push((await admit(c, provider, caller)).outcome);
  return out;
};
const setBudget = (c: pg.ClientBase, key: string, caller: string | null, field: string, value: number | null, actor = "owner", reason = "a test change"): Promise<pg.QueryResult> =>
  c.query("select control.set_budget($1, $2, $3, $4, $5, $6)", [key, caller, field, value, actor, reason]);
const sbRefused = (c: pg.ClientBase, key: string, caller: string | null, field: string, value: number | null, actor = "owner", reason = "a test change"): ReturnType<typeof refused> =>
  refused(c, "select control.set_budget($1, $2, $3, $4, $5, $6)", [key, caller, field, value, actor, reason]);
const shares = async (c: Queryable, key: string): Promise<string[]> =>
  (await rows<{ s: string }>(c, "select caller || ' ' || floor || '/' || cap as s from control.shares where budget_key = $1 order by caller", [key])).map((x) => x.s);
const immediate = (c: pg.ClientBase): ReturnType<typeof refused> => refused(c, "set constraints all immediate");
const reason = (c: pg.ClientBase): Promise<pg.QueryResult> => c.query("select set_config('viafrei.reason', 'planted by the test', true)");

describe.skipIf(url === undefined)("the control plane", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "control");

  beforeAll(async () => {
    await t.make([]);
    await t.pool.query("select * from control.publish_terms($1::jsonb)", [JSON.stringify(TERMS)]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  beforeEach(async () => {
    // Every test starts from the published seed: nothing spent, nothing held.
    expect((await t.pool.query("select 1 from control.usage union all select 1 from control.refusals")).rows).toEqual([]);
  });

  describe("publish_terms", () => {
    it("publishes callers, budgets with their ceiling at the licence, a state row per budget and the seed shares — audited as publish_terms", async () => {
      const b = await rows<{ budget_key: string; ceiling: number; spacing_ms: number | null; burst_max: number | null; hold_s: number }>(
        t.pool,
        "select budget_key, ceiling, spacing_ms, burst_max, hold_s from control.budgets order by budget_key",
      );
      expect(b).toEqual([
        { budget_key: "bursty", ceiling: 100, spacing_ms: null, burst_max: 3, hold_s: 0 },
        { budget_key: "plain", ceiling: 10, spacing_ms: null, burst_max: null, hold_s: 0 },
        { budget_key: "spaced", ceiling: 60, spacing_ms: 60000, burst_max: null, hold_s: 300 },
      ]);
      expect((await rows<{ k: string }>(t.pool, "select budget_key as k from control.budget_state order by 1")).map((x) => x.k)).toEqual(["bursty", "plain", "spaced"]);
      expect(await shares(t.pool, "plain")).toEqual(["cl 2/7", "tl 2/7", "wk 1/6"]);
      const audit = await one<{ n: number; actors: string[] }>(t.pool, "select count(*)::int as n, array_agg(distinct actor) as actors from control.changes");
      expect(audit.n).toBeGreaterThan(0);
      expect(audit.actors).toEqual(["publish_terms"]);
    });

    it("re-publishing changes nothing in force: a lowered ceiling and a changed cap stay, a share is seeded once; an empty declaration is refused", async () => {
      await t.planted(async (c) => {
        await setBudget(c, "plain", null, "ceiling", 9);
        await setBudget(c, "plain", "tl", "cap", 5);
        const again = await one<{ callers: number; budgets: number; providers: number; shares: number }>(c, "select * from control.publish_terms($1::jsonb)", [JSON.stringify(TERMS)]);
        expect(again).toEqual({ callers: 0, budgets: 0, providers: 0, shares: 0 });
        expect((await one<{ ceiling: number }>(c, "select ceiling from control.budgets where budget_key = 'plain'")).ceiling).toBe(9);
        expect(await shares(c, "plain")).toContain("tl 2/5");
        // a changed licence text rewrites the budget, and still keeps the ceiling in force
        const moved = { ...TERMS, budgets: TERMS.budgets.map((b) => (b.budget_key === "plain" ? { ...b, licence_source: "test terms, plain, v2" } : b)) };
        expect((await one<{ budgets: number }>(c, "select budgets from control.publish_terms($1::jsonb)", [JSON.stringify(moved)])).budgets).toBe(1);
        expect((await one<{ ceiling: number; s: string }>(c, "select ceiling, licence_source as s from control.budgets where budget_key = 'plain'"))).toEqual({ ceiling: 9, s: "test terms, plain, v2" });
        expect(await immediate(c)).toBeNull();
        for (const bad of [{}, { ...TERMS, budgets: [] }, { ...TERMS, callers: "x" }, { ...TERMS, providers: [] }]) {
          expect((await refused(c, "select control.publish_terms($1::jsonb)", [JSON.stringify(bad)]))?.detail).toBe("empty-declaration");
        }
        expect((await refused(c, "select control.publish_terms(null)"))?.detail).toBe("empty-declaration");
      });
    });

    it("a new share is seeded and fitted in the same run", async () => {
      await t.planted(async (c) => {
        const more = { ...TERMS, shares: [...TERMS.shares, { budget_key: "plain", caller: "lone", floor: 0, cap: 10 }] };
        const r = await one<{ shares: number }>(c, "select shares from control.publish_terms($1::jsonb)", [JSON.stringify(more)]);
        expect(r.shares).toBe(1);
        // floors 2+2+1+1 = 6 ≤ 10; each cap ≤ 10 − the others' floors.
        expect(await shares(c, "plain")).toEqual(["cl 2/6", "lone 1/5", "tl 2/6", "wk 1/5"]);
        expect(await immediate(c)).toBeNull();
      });
    });
  });

  describe("admit", () => {
    it("share, reserved and ceiling: a caller stops at its cap, the others where they would eat an unmet floor, and the floor's owner still goes to the ceiling", async () => {
      await t.planted(async (c) => {
        expect(await outcomes(c, "p_plain", "tl", 8)).toEqual([...Array<string>(7).fill("admitted"), "share"]);
        // 7 spent; cl's floor of 2 is unmet: wk goes once (7 + 2 < 10), then stops for the reserve.
        expect(await outcomes(c, "p_plain", "wk", 2)).toEqual(["admitted", "reserved"]);
        // cl's own floor is not reserved against it: it goes to the ceiling.
        expect(await outcomes(c, "p_plain", "cl", 3)).toEqual(["admitted", "admitted", "ceiling"]);
        const share = await one<{ wait_ms: number }>(c, "select wait_ms from control.refusals where caller = 'tl' and outcome = 'share'");
        expect(share.wait_ms).toBeGreaterThan(3_500_000);
        expect(share.wait_ms).toBeLessThanOrEqual(3_660_000);
        const used = await one<{ n: number }>(c, "select sum(admitted)::int as n from control.usage where budget_key = 'plain'");
        expect(used.n).toBe(10);
        const last = await admit(c, "p_plain", "wk");
        expect(last).toMatchObject({ admitted: false, outcome: "ceiling", token: null });
      });
    });

    it("an admission returns its bucket as the token and records the slot; a refusal records its row with the subject", async () => {
      await t.planted(async (c) => {
        const a = await admit(c, "p_plain", "wk");
        expect(a.admitted).toBe(true);
        expect(a.wait_ms).toBe(0);
        const u = await one<{ tok: string; admitted: number; by: string }>(
          c,
          "select extract(epoch from g.bucket_start)::bigint::text as tok, g.admitted, s.last_admitted_by as by from control.usage g join control.budget_state s using (budget_key) where g.budget_key = 'plain'",
        );
        expect(u).toEqual({ tok: a.token, admitted: 1, by: "wk" });
        // a minute bucket for an hour window
        expect(Number(a.token) % 60).toBe(0);
      });
    });

    it("no-budget and no-share: an unknown provider, an unknown caller and a caller without a share each leave a refusal row", async () => {
      await t.planted(async (c) => {
        expect(await admit(c, "nobody", "wk")).toMatchObject({ admitted: false, outcome: "no-budget" });
        expect(await admit(c, "p_plain", "ghost")).toMatchObject({ admitted: false, outcome: "no-share" });
        expect(await admit(c, "p_plain", "lone")).toMatchObject({ admitted: false, outcome: "no-share" });
        await c.query("delete from control.budget_state where budget_key = 'bursty'");
        expect(await admit(c, "p_bursty", "wk")).toMatchObject({ admitted: false, outcome: "no-budget" });
        const r = await rows<{ x: string }>(c, "select budget_key || ' ' || caller || ' ' || outcome || ' ' || subject as x from control.refusals order by id");
        expect(r.map((x) => x.x)).toEqual(["nobody wk no-budget test", "plain ghost no-share test", "plain lone no-share test", "bursty wk no-budget test"]);
      });
    });

    it("the MCP role may name only an mcp caller: a worker's share is no-share from there, its own goes", async () => {
      await t.planted(async (c) => {
        await c.query("set local role viafrei_mcp");
        expect((await admit(c, "p_plain", "wk")).outcome).toBe("no-share");
        expect((await admit(c, "p_plain", "tl")).outcome).toBe("admitted");
      });
    });

    it("spacing, the person's stamp and the owed mark: a person refused for the spacing below its floor is owed the next slot; the background yields to it", async () => {
      await t.planted(async (c) => {
        expect((await admit(c, "p_spaced", "wk")).outcome).toBe("admitted");
        const sp = await admit(c, "p_spaced", "wk");
        expect(sp.outcome).toBe("spacing");
        expect(sp.wait_ms).toBeGreaterThan(55_000);
        expect(sp.wait_ms).toBeLessThanOrEqual(60_000);
        // the person, below its floor, refused for the spacing: owed, and its ask is stamped
        expect((await admit(c, "p_spaced", "tl")).outcome).toBe("spacing");
        const s1 = await one<{ owed_by: string | null; wanted: boolean }>(c, "select owed_by, person_wanted_at is not null as wanted from control.budget_state where budget_key = 'spaced'");
        expect(s1).toEqual({ owed_by: "tl", wanted: true });
        // the spacing has passed; the person's ask is recent: the background yields
        await c.query("update control.budget_state set last_admitted_at = clock_timestamp() - interval '2 minutes' where budget_key = 'spaced'");
        expect((await admit(c, "p_spaced", "wk")).outcome).toBe("yield");
        // without the stamp the owed mark alone holds a caller at its floor back
        await c.query("update control.budget_state set person_wanted_at = null where budget_key = 'spaced'");
        expect((await admit(c, "p_spaced", "wk")).outcome).toBe("yield");
        expect((await admit(c, "p_spaced", "tl")).outcome).toBe("admitted");
        const s2 = await one<{ owed_by: string | null; owed_at: string | null; by: string }>(c, "select owed_by, owed_at, last_admitted_by as by from control.budget_state where budget_key = 'spaced'");
        expect(s2).toEqual({ owed_by: null, owed_at: null, by: "tl" });
      });
    });

    it("a stale stamp or mark holds nobody back: after two spacings the background goes", async () => {
      await t.planted(async (c) => {
        await c.query(
          "update control.budget_state set person_wanted_at = clock_timestamp() - interval '121 seconds', owed_by = 'tl', owed_at = clock_timestamp() - interval '121 seconds' where budget_key = 'spaced'",
        );
        expect((await admit(c, "p_spaced", "wk")).outcome).toBe("admitted");
      });
    });

    it("burst: three a minute key-wide, the fourth refused whoever asks", async () => {
      await t.planted(async (c) => {
        expect(await outcomes(c, "p_bursty", "wk", 3)).toEqual(["admitted", "admitted", "admitted"]);
        expect((await admit(c, "p_bursty", "wk")).outcome).toBe("burst");
        expect((await admit(c, "p_bursty", "cl")).outcome).toBe("burst");
      });
    });
  });

  describe("hold, want and release", () => {
    it("hold: a 5xx holds a key with a hold for its hold_s and admit refuses it; a key without one is never held; a reason outside the list is refused", async () => {
      await t.planted(async (c) => {
        const h = await one<{ s: number }>(c, "select extract(epoch from control.hold('p_spaced', '5xx') - clock_timestamp())::int as s");
        expect(h.s).toBeGreaterThan(295);
        expect(h.s).toBeLessThanOrEqual(300);
        expect((await one<{ r: string }>(c, "select held_reason as r from control.budget_state where budget_key = 'spaced'")).r).toBe("5xx");
        const a = await admit(c, "p_spaced", "tl");
        expect(a.outcome).toBe("hold");
        expect(a.wait_ms).toBeGreaterThan(290_000);
        expect((await one<{ u: string | null }>(c, "select control.hold('p_plain', '429') as u")).u).toBeNull();
        expect((await one<{ u: string | null }>(c, "select control.hold('nobody', '429') as u")).u).toBeNull();
        expect((await one<{ u: string | null }>(c, "select held_until as u from control.budget_state where budget_key = 'plain'")).u).toBeNull();
        expect((await refused(c, "select control.hold('p_spaced', 'teapot')"))?.detail).toBe("bad-reason");
        expect((await refused(c, "select control.hold('p_spaced', null)"))?.detail).toBe("bad-reason");
      });
    });

    it("a hold never shortens one in force", async () => {
      await t.planted(async (c) => {
        await c.query("update control.budget_state set held_until = clock_timestamp() + interval '1 hour' where budget_key = 'spaced'");
        await c.query("select control.hold('p_spaced', 'owner')");
        const s = await one<{ m: number }>(c, "select extract(epoch from held_until - clock_timestamp())::int as m from control.budget_state where budget_key = 'spaced'");
        expect(s.m).toBeGreaterThan(3500);
      });
    });

    it("want stamps a spaced key's person ask and leaves a key without spacing alone", async () => {
      await t.planted(async (c) => {
        await c.query("select control.want('p_spaced'), control.want('p_plain'), control.want('nobody')");
        const s = await rows<{ k: string; w: boolean }>(c, "select budget_key as k, person_wanted_at is not null as w from control.budget_state order by 1");
        expect(s).toEqual([
          { k: "bursty", w: false },
          { k: "plain", w: false },
          { k: "spaced", w: true },
        ]);
        expect((await admit(c, "p_spaced", "wk")).outcome).toBe("yield");
      });
    });

    it("release: an unsent slot is counted not-sent once, and is free again; a malformed token or an unknown provider changes nothing", async () => {
      await t.planted(async (c) => {
        const toks: string[] = [];
        for (let i = 0; i < 6; i += 1) toks.push((await admit(c, "p_plain", "wk")).token ?? "");
        expect((await admit(c, "p_plain", "wk")).outcome).toBe("share");
        const tok = toks[0] ?? "";
        await c.query("select control.release('p_plain', 'wk', $1)", [tok]);
        await c.query("select control.release('p_plain', 'wk', 'x1'), control.release('nobody', 'wk', $1), control.release('p_plain', 'wk', null)", [tok]);
        const u = await one<{ a: number; n: number }>(c, "select sum(admitted)::int as a, sum(not_sent)::int as n from control.usage where budget_key = 'plain' and caller = 'wk'");
        expect(u).toEqual({ a: 6, n: 1 });
        expect((await admit(c, "p_plain", "wk")).outcome).toBe("admitted");
        // a bucket's releases never pass its admissions
        const bucket = await one<{ a: number }>(c, "select admitted as a from control.usage where budget_key = 'plain' and caller = 'wk' and bucket_start = to_timestamp($1::bigint)", [tok]);
        for (let i = 0; i < bucket.a + 2; i += 1) await c.query("select control.release('p_plain', 'wk', $1)", [tok]);
        const b = await one<{ a: number; n: number }>(c, "select admitted as a, not_sent as n from control.usage where budget_key = 'plain' and caller = 'wk' and bucket_start = to_timestamp($1::bigint)", [tok]);
        expect(b.n).toBe(b.a);
      });
    });

    it("bucket_width: a minute of the shorter window, never below one second", async () => {
      const r = await one<{ a: number; b: number; c: number; d: number }>(
        t.pool,
        "select control.bucket_width(3600, null) as a, control.bucket_width(3600, 120) as b, control.bucket_width(30, null) as c, control.bucket_width(61, null) as d",
      );
      expect(r).toEqual({ a: 60, b: 2, c: 1, d: 1 });
    });
  });

  describe("set_budget", () => {
    it("refuses a bad actor, no reason, a negative, an unknown budget, a fraction, above-licence, a shape the key has not, an unknown field", async () => {
      await t.planted(async (c) => {
        const cases: [string, string | null, string, number | null, string, string, string][] = [
          ["plain", null, "ceiling", 5, "Owner!", "a test change", "bad-actor"],
          ["plain", null, "ceiling", 5, "owner", "x", "no-reason"],
          ["plain", null, "ceiling", -1, "owner", "a test change", "negative"],
          ["plain", null, "ceiling", null, "owner", "a test change", "negative"],
          ["nokey", null, "ceiling", 5, "owner", "a test change", "unknown-budget"],
          ["plain", null, "ceiling", 1.5, "owner", "a test change", "not-integer"],
          ["plain", null, "ceiling", 11, "owner", "a test change", "above-licence"],
          ["plain", null, "burst_max", 1, "owner", "a test change", "no-shape"],
          ["bursty", null, "burst_max", 4, "owner", "a test change", "above-licence"],
          ["plain", null, "spacing_ms", 1000, "owner", "a test change", "no-shape"],
          ["spaced", null, "spacing_ms", 59999, "owner", "a test change", "above-licence"],
          ["plain", null, "window_s", 60, "owner", "a test change", "unknown-field"],
          ["plain", "lone", "cap", 1, "owner", "a test change", "unknown-caller"],
          ["plain", "tl", "cap", 1, "owner", "a test change", "below-floor"],
          ["plain", "tl", "floor", 8, "owner", "a test change", "above-cap"],
          ["plain", "tl", "purpose", 1, "owner", "a test change", "unknown-field"],
        ];
        for (const [k, who, f, v, actor, why, detail] of cases) {
          expect([k, who, f, v, (await sbRefused(c, k, who, f, v, actor, why))?.detail]).toEqual([k, who, f, v, detail]);
        }
      });
    });

    it("a lowered ceiling fits the caps in the same call and is audited with its actor and reason; a raised one raises nothing", async () => {
      await t.planted(async (c) => {
        await setBudget(c, "plain", null, "ceiling", 8, "owner", "lower for the test");
        expect(await shares(c, "plain")).toEqual(["cl 2/5", "tl 2/5", "wk 1/4"]);
        expect(await immediate(c)).toBeNull();
        const ch = await rows<{ x: string }>(c, "select tbl || ' ' || coalesce(caller, '-') || ' ' || field || ' ' || before || '>' || after as x from control.changes where actor = 'owner' and reason = 'lower for the test' order by id");
        expect(ch.map((x) => x.x).sort()).toEqual(["budgets - ceiling 10>8", "shares cl cap 7>5", "shares tl cap 7>5", "shares wk cap 6>4"]);
        await setBudget(c, "plain", null, "ceiling", 10);
        expect(await shares(c, "plain")).toEqual(["cl 2/5", "tl 2/5", "wk 1/4"]);
      });
    });

    it("a ceiling of 0 pauses the key; burst, spacing and reserve are set within the licence", async () => {
      await t.planted(async (c) => {
        await setBudget(c, "plain", null, "ceiling", 0);
        expect(await shares(c, "plain")).toEqual(["cl 0/0", "tl 0/0", "wk 0/0"]);
        expect(await immediate(c)).toBeNull();
        expect((await admit(c, "p_plain", "tl")).outcome).toBe("ceiling");
        await setBudget(c, "bursty", null, "burst_max", 2);
        await setBudget(c, "spaced", null, "spacing_ms", 120000);
        await setBudget(c, "plain", null, "reserve_pct", 0.25);
        const b = await rows<{ x: string }>(c, "select budget_key || ' ' || coalesce(burst_max::text, '-') || ' ' || coalesce(spacing_ms::text, '-') || ' ' || reserve_pct as x from control.budgets order by 1");
        expect(b.map((x) => x.x)).toEqual(["bursty 2 - 0.000", "plain - - 0.250", "spaced - 120000 0.000"]);
      });
    });

    it("a cap of 0 switches one door off with its floor; a cap back above 0 gives it a floor of 1", async () => {
      await t.planted(async (c) => {
        await setBudget(c, "plain", "tl", "cap", 0);
        expect(await shares(c, "plain")).toContain("tl 0/0");
        expect(await immediate(c)).toBeNull();
        expect((await admit(c, "p_plain", "tl")).outcome).toBe("share");
        await setBudget(c, "plain", "tl", "cap", 3);
        expect(await shares(c, "plain")).toContain("tl 1/3");
        await setBudget(c, "plain", "tl", "floor", 2);
        expect(await shares(c, "plain")).toContain("tl 2/3");
        expect(await immediate(c)).toBeNull();
      });
    });
  });

  describe("fit_shares and the shape triggers", () => {
    it("a key planted as before the shares had floors (no floors, each cap the whole key) comes out inside the bound, and a second run changes nothing", async () => {
      await t.planted(async (c) => {
        await reason(c);
        await c.query("update control.shares set floor = 0, cap = 10 where budget_key = 'plain'");
        expect((await one<{ n: number }>(c, "select control.fit_shares('plain') as n")).n).toBe(6);
        expect(await shares(c, "plain")).toEqual(["cl 1/8", "tl 1/8", "wk 1/8"]);
        expect((await one<{ n: number }>(c, "select control.fit_shares('plain') as n")).n).toBe(0);
        expect(await immediate(c)).toBeNull();
        expect((await one<{ n: number }>(c, "select control.fit_shares('nokey') as n")).n).toBe(0);
      });
    });

    it("floors that no longer fit fall to 1 each; a door switched off stays 0/0 and the others are fitted without it", async () => {
      await t.planted(async (c) => {
        await reason(c);
        await c.query("update control.shares set floor = 0, cap = 0 where budget_key = 'plain' and caller = 'cl'");
        await c.query("update control.shares set floor = 6, cap = 10 where budget_key = 'plain' and caller <> 'cl'");
        await c.query("select control.fit_shares('plain')");
        expect(await shares(c, "plain")).toEqual(["cl 0/0", "tl 1/9", "wk 1/9"]);
        expect(await immediate(c)).toBeNull();
      });
    });

    it("a ceiling below the callers switched on is refused by name; a paused key and a key of one caller are fitted to the ceiling", async () => {
      await t.planted(async (c) => {
        await reason(c);
        await c.query("update control.budgets set ceiling = 2 where budget_key = 'plain'");
        expect((await refused(c, "select control.fit_shares('plain')"))?.detail).toBe("ceiling-below-callers");
        await c.query("update control.budgets set ceiling = 0 where budget_key = 'plain'");
        await c.query("select control.fit_shares('plain')");
        expect(await shares(c, "plain")).toEqual(["cl 0/0", "tl 0/0", "wk 0/0"]);
        await c.query("update control.shares set floor = 0, cap = 0 where budget_key = 'bursty' and caller = 'cl'");
        await c.query("update control.budgets set ceiling = 20 where budget_key = 'bursty'");
        await c.query("select control.fit_shares('bursty')");
        expect(await shares(c, "bursty")).toEqual(["cl 0/0", "wk 1/20"]);
        expect(await immediate(c)).toBeNull();
      });
    });

    it("the shape is checked at commit, however the row is written: cap over ceiling, floors over ceiling, no floor, a cap that takes the others' floors", async () => {
      const planted: [string, string][] = [
        ["update control.shares set cap = 11 where budget_key = 'plain' and caller = 'wk'", "cap-over-ceiling"],
        ["update control.budgets set ceiling = 5 where budget_key = 'plain'", "cap-over-ceiling"],
        ["update control.shares set floor = 6 where budget_key = 'plain' and caller in ('tl', 'cl')", "floors-over-ceiling"],
        ["update control.shares set floor = 0 where budget_key = 'plain' and caller = 'wk'", "no-floor"],
        ["update control.shares set cap = 7 where budget_key = 'plain' and caller = 'wk'", "cap-takes-floors"],
        ["insert into control.shares (budget_key, caller, floor, cap) values ('plain', 'lone', 0, 1)", "no-floor"],
      ];
      for (const [sql, detail] of planted) {
        await t.planted(async (c) => {
          await reason(c);
          // deferred: the statement itself goes, the commit (here: immediate) refuses
          expect(await refused(c, sql)).toBeNull();
          expect([sql, (await immediate(c))?.detail]).toEqual([sql, detail]);
        });
      }
      await t.planted(async (c) => {
        await reason(c);
        // a key of one caller may keep a floor of 0; a key of many is fine at its bound
        await c.query("update control.shares set floor = 0 where budget_key = 'spaced' and caller = 'tl'");
        await c.query("delete from control.shares where budget_key = 'spaced' and caller = 'wk'");
        await c.query("update control.shares set cap = 6 where budget_key = 'plain' and caller = 'wk'");
        expect(await immediate(c)).toBeNull();
      });
    });
  });

  describe("the audit", () => {
    it("a change to budgets, callers or shares without a reason is refused; with one, each changed field is a row, an insert or delete one '*' row", async () => {
      await t.planted(async (c) => {
        expect((await refused(c, "update control.budgets set hold_s = 5 where budget_key = 'plain'"))?.detail).toBe("no-reason");
        expect((await refused(c, "update control.callers set purpose = 'another purpose' where caller = 'wk'"))?.detail).toBe("no-reason");
        expect((await refused(c, "update control.shares set cap = 5 where budget_key = 'plain' and caller = 'wk'"))?.detail).toBe("no-reason");
        await reason(c);
        await c.query("select set_config('viafrei.actor', 'tester', true)");
        await c.query("update control.budgets set hold_s = 5, reserve_pct = 0.1 where budget_key = 'plain'");
        await c.query("update control.budgets set hold_s = 5 where budget_key = 'plain'");
        await c.query("insert into control.callers values ('newc', 'cli', false, 'a new caller')");
        await c.query("delete from control.shares where budget_key = 'plain' and caller = 'wk'");
        const ch = await rows<{ x: string; before: unknown; after: unknown }>(
          c,
          "select tbl || ' ' || coalesce(budget_key, '-') || ' ' || coalesce(caller, '-') || ' ' || field as x, before::jsonb as before, after::jsonb as after from control.changes where actor = 'tester' order by id",
        );
        expect(ch).toEqual([
          { x: "budgets plain - hold_s", before: 0, after: 5 },
          { x: "budgets plain - reserve_pct", before: 0, after: 0.1 },
          { x: "callers - newc *", before: null, after: { caller: "newc", process: "cli", person: false, purpose: "a new caller" } },
          { x: "shares plain wk *", before: { budget_key: "plain", caller: "wk", floor: 1, cap: 6 }, after: null },
        ]);
      });
    });

    it("the actor defaults to the role that made the change", async () => {
      await t.planted(async (c) => {
        await reason(c);
        await c.query("update control.budgets set hold_s = 7 where budget_key = 'plain'");
        expect((await one<{ a: string }>(c, "select actor as a from control.changes where field = 'hold_s' and after = '7'")).a).toBe((await one<{ u: string }>(c, "select current_user as u")).u);
      });
    });

    it("control.changes is append-only: an update and a delete are refused", async () => {
      await t.planted(async (c) => {
        expect((await refused(c, "update control.changes set reason = 'rewritten'"))?.detail).toBe("append-only");
        expect((await refused(c, "delete from control.changes"))?.detail).toBe("append-only");
        expect((await refused(c, "insert into control.changes (at, actor, reason, tbl, field) values (now(), 'a', 'r', 't', 'f')"))).toBeNull();
      });
    });

    it("every control trigger fires always: session_replication_role = replica skips none", async () => {
      const r = await rows<{ x: string }>(
        t.pool,
        "select tgrelid::regclass || ' ' || tgname || ' ' || tgenabled::text as x from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'control.%' order by 1",
      );
      expect(r.map((x) => x.x)).toEqual([
        "control.budgets budgets_audit A",
        "control.budgets budgets_shape A",
        "control.callers callers_audit A",
        "control.changes changes_append_only A",
        "control.shares shares_audit A",
        "control.shares shares_shape A",
      ]);
      await t.planted(async (c) => {
        await c.query("set local session_replication_role = replica");
        expect((await refused(c, "update control.budgets set hold_s = 5 where budget_key = 'plain'"))?.detail).toBe("no-reason");
        expect((await refused(c, "delete from control.changes"))?.detail).toBe("append-only");
      });
    });
  });

  describe("rollup_refresh", () => {
    it("the hourly rollup equals the ledger, caller by caller and outcome by outcome, with the shape in force", async () => {
      await t.planted(async (c) => {
        const tok = (await admit(c, "p_plain", "wk")).token;
        await outcomes(c, "p_plain", "wk", 6);
        await c.query("select control.release('p_plain', 'wk', $1)", [tok]);
        await admit(c, "p_plain", "ghost");
        await admit(c, "p_bursty", "cl");
        const r = await one<{ hourly_rows: number }>(c, "select * from control.rollup_refresh()");
        expect(r.hourly_rows).toBeGreaterThanOrEqual(3);
        const h = await rows<{ x: string }>(
          c,
          `select budget_key || ' ' || caller || ' ' || sum(admitted) || ' ' || sum(not_sent) || ' ' || sum(refused_share) || ' ' || sum(refused_unconfigured)
                  || ' ' || coalesce(max(ceiling_at)::text, '-') || ' ' || coalesce(max(cap_at)::text, '-') || ' ' || coalesce(max(floor_at)::text, '-') as x
             from control.usage_hourly group by budget_key, caller order by 1`,
        );
        expect(h.map((x) => x.x)).toEqual(["bursty cl 1 0 0 0 100 50 1", "plain ghost 0 0 0 1 10 - -", "plain wk 6 1 1 0 10 6 1"]);
        // a second run over the same hours rewrites, it never adds
        await c.query("select * from control.rollup_refresh()");
        expect((await one<{ a: number }>(c, "select sum(admitted)::int as a from control.usage_hourly where caller = 'wk'")).a).toBe(6);
      });
    });

    it("retention: usage keeps 48 h, refusals 14 days, usage_hourly 90 days — the row just inside each is kept", async () => {
      await t.planted(async (c) => {
        await c.query(`insert into control.usage (budget_key, caller, bucket_start, admitted) values
          ('plain', 'wk', now() - interval '48 hours 1 minute', 1), ('plain', 'wk', now() - interval '47 hours', 1)`);
        await c.query(`insert into control.refusals (at, budget_key, provider, caller, outcome) values
          (now() - interval '14 days 1 minute', 'plain', 'p_plain', 'wk', 'share'), (now() - interval '13 days', 'plain', 'p_plain', 'wk', 'share')`);
        await c.query(`insert into control.usage_hourly (hour, budget_key, caller, computed_at) values
          (date_trunc('hour', now() - interval '90 days 1 hour'), 'plain', 'wk', now()), (date_trunc('hour', now() - interval '89 days'), 'plain', 'wk', now())`);
        const r = await one<{ usage_deleted: number; refusals_deleted: number; hourly_deleted: number }>(c, "select usage_deleted, refusals_deleted, hourly_deleted from control.rollup_refresh()");
        expect(r).toEqual({ usage_deleted: 1, refusals_deleted: 1, hourly_deleted: 1 });
        const left = await one<{ u: number; r: number; h: number }>(
          c,
          "select (select count(*) from control.usage)::int as u, (select count(*) from control.refusals)::int as r, (select count(*) from control.usage_hourly where hour < now() - interval '80 days')::int as h",
        );
        expect(left).toEqual({ u: 1, r: 1, h: 1 });
      });
    });
  });
});
