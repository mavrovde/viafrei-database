import { describe, expect, it } from "vitest";
import { controlRuns, formatCosts, type Mutant, type MutateIo, parseCosts, parseShard, planShards, runMutants, shardOf } from "../scripts/mutate-run.js";

const DEFAULTS = { file: "plan.ts", tests: ["test/plan.test.ts"] };
const MUTANTS: readonly Mutant[] = [
  { name: "unit a", from: "a", to: "A" },
  { name: "unit b", from: "b", to: "B", file: "cli.ts", tests: ["test/cli.test.ts"] },
  { name: "unit c", from: "c", to: "C" },
  { name: "db d", from: "d", to: "D", file: "base.sql", tests: ["test/x.db.test.ts"], config: "vitest.db.config.ts" },
];

/**
 * An in-memory tree and a vitest stand-in: a run fails when one of `red` is
 * among its tests (an unmutated failure), or when a file it guards carries a
 * planted mutant and the mutant is not in `survive`.
 */
function fake(red: readonly string[], survive: readonly string[] = []) {
  const files = new Map([["plan.ts", "a c"], ["cli.ts", "b"], ["base.sql", "d"]]);
  const runs: string[] = [];
  const writes: string[] = [];
  const lines: string[] = [];
  const io: MutateIo = {
    run: (config, tests) => {
      runs.push(`${config ?? "unit"}: ${tests.join(" ")}`);
      if (tests.some((t) => red.includes(t))) return 1;
      const planted = [...files.values()].some((t) => /[A-Z]/.test(t) && !survive.some((s) => t.includes(s)));
      return planted ? 1 : 0;
    },
    read: (f) => files.get(f) ?? "",
    write: (f, t) => {
      writes.push(f);
      files.set(f, t);
    },
    log: (l) => lines.push(l),
  };
  return { io, files, runs, writes, lines };
}

describe("the mutation runner", () => {
  it("makes each distinct run once, unit and database alike", () => {
    expect(controlRuns(MUTANTS, DEFAULTS)).toEqual([
      [undefined, ["test/plan.test.ts"]],
      [undefined, ["test/cli.test.ts"]],
      ["vitest.db.config.ts", ["test/x.db.test.ts"]],
    ]);
  });

  it("refuses with exit 2, before any mutant is planted, when a UNIT run fails unmutated", () => {
    const f = fake(["test/cli.test.ts"]);
    expect(runMutants(MUTANTS, DEFAULTS, f.io)).toEqual({ code: 2, killed: 0, survived: 0 });
    expect(f.writes).toEqual([]);
    expect(f.runs).toEqual(["unit: test/plan.test.ts", "unit: test/cli.test.ts"]);
    expect(f.lines.at(-1)).toBe("✗ refused: test/cli.test.ts fails UNMUTATED under the unit config — no mutant of it can be judged");
  });

  it("refuses with exit 2 when a database run fails unmutated", () => {
    const f = fake(["test/x.db.test.ts"]);
    expect(runMutants(MUTANTS, DEFAULTS, f.io)).toEqual({ code: 2, killed: 0, survived: 0 });
    expect(f.writes).toEqual([]);
    expect(f.lines.at(-1)).toContain("fails UNMUTATED under vitest.db.config.ts (TEST_DATABASE_URL and psql set?)");
  });

  it("with green controls, kills each mutant and restores every file", () => {
    const f = fake([]);
    expect(runMutants(MUTANTS, DEFAULTS, f.io)).toEqual({ code: 0, killed: 4, survived: 0 });
    expect(f.runs.slice(0, 3)).toEqual(["unit: test/plan.test.ts", "unit: test/cli.test.ts", "vitest.db.config.ts: test/x.db.test.ts"]);
    expect(Object.fromEntries(f.files)).toEqual({ "plan.ts": "a c", "cli.ts": "b", "base.sql": "d" });
    expect(f.lines.at(-1)).toBe("✓ mutants: 4 killed, 0 survived");
  });

  it("a survivor and a pattern that matches nothing are each exit 1", () => {
    const f = fake([], ["B"]);
    expect(runMutants([...MUTANTS, { name: "gone", from: "zzz", to: "Z" }], DEFAULTS, f.io)).toEqual({ code: 1, killed: 3, survived: 2 });
    expect(f.lines).toContain("  ✗ SURVIVED: unit b");
    expect(f.lines).toContain("  ? gone: the pattern no longer matches plan.ts — fix the mutant");
    expect(f.files.get("cli.ts")).toBe("b");
  });

  it("a pattern found in two places plants nothing and is exit 1, and so is a mutant that changes nothing", () => {
    const f = fake([]);
    f.files.set("plan.ts", "a c a");
    const twice = MUTANTS.filter((m) => m.name === "unit a");
    expect(runMutants([...twice, { name: "same", from: "c", to: "c" }], DEFAULTS, f.io)).toEqual({ code: 1, killed: 0, survived: 2 });
    expect(f.lines).toContain("  ? unit a: the pattern matches 2 places of plan.ts — fix the mutant");
    expect(f.lines).toContain("  ? same: the mutant changes nothing in plan.ts — fix the mutant");
    expect(f.runs).toEqual(["unit: test/plan.test.ts"]);
    expect(f.files.get("plan.ts")).toBe("a c a");
  });
});

describe("the shards of the set", () => {
  it("takes k/n with 1 <= k <= n and nothing else", () => {
    expect(parseShard("1/4")).toEqual({ index: 1, count: 4 });
    expect(parseShard("4/4")).toEqual({ index: 4, count: 4 });
    expect(parseShard("1/1")).toEqual({ index: 1, count: 1 });
    for (const bad of ["0/4", "5/4", "1/0", "-1/4", "1/4/2", "1.5/4", "01/4", "a/4", "1", "", " 1/4"]) expect(parseShard(bad), bad).toBeNull();
  });

  const unit = (name: string, run = "u"): Mutant => ({ name, from: name, to: name.toUpperCase(), tests: [`test/${run}.test.ts`] });
  const T = { tests: ["test/plan.test.ts"] };

  it("cuts disjoint shards that together are the whole list, for any length, count and costs", () => {
    for (const length of [0, 1, 3, 4, 5, 9, 60]) {
      const list = Array.from({ length }, (_, i) => unit(`m${String(i)}`, `r${String(i % 5)}`));
      const costs = new Map(list.filter((_, i) => i % 7 !== 3).map((m, i) => [m.name, (i * 37) % 23] as const));
      for (const count of [1, 2, 4, 7]) {
        const shards = Array.from({ length: count }, (_, k) => shardOf(list, { index: k + 1, count }, costs, T));
        const names = shards.flat().map((m) => m.name);
        expect(new Set(names).size, `${String(length)}/${String(count)}`).toBe(names.length);
        expect(names.sort()).toEqual(list.map((m) => m.name).sort());
      }
    }
  });

  it("balances by cost: a dear mutant gets a shard of its own, and the rest are dealt around it", () => {
    const list = ["a", "b", "c", "d", "e"].map((n) => unit(n));
    const costs = new Map([["a", 1], ["b", 1], ["c", 10], ["d", 1], ["e", 1]]);
    const p = planShards(list, 2, costs, T);
    // c first (dearest) to shard 0; then a, b, d, e (equal, by position) to shard 1 while it is cheaper.
    expect(p.assign).toEqual([1, 1, 0, 1, 1]);
    // A shard's load is its mutants plus one control run per distinct run (the median of that run's mutants: 1).
    expect(p.loads).toEqual([10 + 1, 4 + 1]);
  });

  it("counts in a shard's load one control run per distinct run it holds, and gathers a run where its control is paid", () => {
    const list = [unit("y", "y"), unit("x1", "x"), unit("x2", "x"), unit("x3", "x")];
    const costs = new Map([["y", 6], ["x1", 2], ["x2", 2], ["x3", 2]]);
    const p = planShards(list, 2, costs, T);
    expect(p.assign).toEqual([0, 1, 1, 1]);
    expect(p.loads).toEqual([6 + 6, 3 * 2 + 2]);
    for (const count of [1, 3, 5]) {
      const many = Array.from({ length: 40 }, (_, i) => unit(`m${String(i)}`, `r${String(i % 6)}`));
      const c = new Map(many.map((m, i) => [m.name, 1 + ((i * 13) % 17)] as const));
      const q = planShards(many, count, c, T);
      const control = (run: string): number => {
        const v = many.filter((m) => m.tests?.[0] === run).map((m) => c.get(m.name)!).sort((x, y) => x - y);
        return v.length % 2 === 1 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2;
      };
      const again = Array.from({ length: count }, (_, s) => {
        const mine = many.filter((_, i) => q.assign[i] === s);
        return mine.reduce((t, m) => t + c.get(m.name)!, 0) + [...new Set(mine.map((m) => m.tests![0]!))].reduce((t, r) => t + control(r), 0);
      });
      expect(q.loads).toEqual(again);
    }
  });

  it("gives a mutant missing from the file the median of the file's costs, and breaks ties the same way every time", () => {
    const list = ["a", "b", "c", "new"].map((n) => unit(n));
    const costs = new Map([["a", 2], ["b", 4], ["c", 9]]);
    // median 4: "new" costs as b does, so it is dealt right after b (equal cost, later position), to the next cheapest shard.
    const p = planShards(list, 3, costs, T);
    expect(p.assign).toEqual([1, 1, 0, 2]);
    expect(planShards(list, 3, costs, T)).toEqual(p);
    // No cost known at all: every mutant costs 1, dealt by position.
    expect(planShards(list, 2, new Map(), T).assign).toEqual([0, 1, 0, 1]);
  });

  it("reads and writes the cost file, and refuses a line it cannot read", () => {
    const costs = parseCosts("# header\n\n6.1\tgate: a b\n12\tlint: c\n");
    expect([...costs]).toEqual([["gate: a b", 6.1], ["lint: c", 12]]);
    expect(parseCosts(formatCosts(costs))).toEqual(costs);
    expect(formatCosts(costs).split("\n").slice(1)).toEqual(["6.1\tgate: a b", "12.0\tlint: c", ""]);
    expect(() => parseCosts("x\tname\n")).toThrow(/line 1/);
    expect(() => parseCosts("-1\tname\n")).toThrow(/line 1/);
    expect(() => parseCosts("3\t\n")).toThrow(/line 1/);
    expect(() => parseCosts("nameonly\n")).toThrow(/line 1/);
    expect(() => parseCosts("1\tn\n2\tn\n")).toThrow(/line 2: "n" is given twice/);
  });

  it("tells each judged mutant's seconds, plant to restore, and none for a refused pattern", () => {
    const f = fake([]);
    let t = 0;
    const seen: Array<[string, number]> = [];
    const io: MutateIo = { ...f.io, clock: () => (t += 1500), cost: (n, s) => seen.push([n, s]) };
    runMutants([...MUTANTS, { name: "gone", from: "zzz", to: "Z" }], DEFAULTS, io);
    expect(seen).toEqual([["unit a", 1.5], ["unit b", 1.5], ["unit c", 1.5], ["db d", 1.5]]);
  });

  it("each shard runs the controls of its own mutants before any is planted", () => {
    const f = fake([]);
    const shard = shardOf(MUTANTS, { index: 2, count: 2 }, new Map(), DEFAULTS);
    expect(shard.map((m) => m.name)).toEqual(["unit b", "db d"]);
    expect(runMutants(shard, DEFAULTS, f.io)).toEqual({ code: 0, killed: 2, survived: 0 });
    expect(f.runs.slice(0, 2)).toEqual(["unit: test/cli.test.ts", "vitest.db.config.ts: test/x.db.test.ts"]);
  });
});
