import { describe, expect, it } from "vitest";
import { controlRuns, type Mutant, type MutateIo, parseShard, runMutants, shardOf } from "../scripts/mutate-run.js";

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

  it("cuts position p into shard p mod n + 1, so the shards are disjoint and together the whole list, for any length", () => {
    expect(shardOf([0, 1, 2, 3, 4, 5, 6, 7, 8], { index: 2, count: 4 })).toEqual([1, 5]);
    for (const length of [0, 1, 3, 4, 5, 9, 817]) {
      const list = Array.from({ length }, (_, i) => i);
      for (const count of [1, 2, 4, 7]) {
        const shards = Array.from({ length: count }, (_, k) => shardOf(list, { index: k + 1, count }));
        expect(shards.flat().sort((a, b) => a - b), `${String(length)}/${String(count)}`).toEqual(list);
        expect(shards.map((s) => s.length).reduce((a, b) => a + b, 0)).toBe(length);
        // even: no two shards differ by more than one mutant
        expect(Math.max(...shards.map((s) => s.length)) - Math.min(...shards.map((s) => s.length))).toBeLessThanOrEqual(1);
      }
    }
  });

  it("each shard runs the controls of its own mutants before any is planted", () => {
    const f = fake([]);
    const shard = shardOf(MUTANTS, { index: 2, count: 2 });
    expect(shard.map((m) => m.name)).toEqual(["unit b", "db d"]);
    expect(runMutants(shard, DEFAULTS, f.io)).toEqual({ code: 0, killed: 2, survived: 0 });
    expect(f.runs.slice(0, 2)).toEqual(["unit: test/cli.test.ts", "vitest.db.config.ts: test/x.db.test.ts"]);
  });
});
