/**
 * The judging half of scripts/mutate.ts, apart from the processes and files it
 * touches so a test can drive it: the unmutated controls, then each mutant.
 *
 * A mutant is killed by a FAILING run, so every distinct run a mutant will
 * make (its config, or none for the unit suite, and its test list) must pass
 * UNMUTATED first, before any file is changed: a database run without
 * TEST_DATABASE_URL, or a unit test that is already red, fails every time and
 * would otherwise read as every mutant of it killed. A failing control is a
 * refusal (exit 2) and no mutant is planted.
 */
export type Mutant = { readonly name: string; readonly from: string; readonly to: string; readonly file?: string; readonly tests?: readonly string[]; readonly config?: string };

export type MutateIo = {
  /** One vitest run; `config` undefined is the unit suite. The status is the process's. */
  readonly run: (config: string | undefined, tests: readonly string[]) => number | null;
  readonly read: (file: string) => string;
  readonly write: (file: string, text: string) => void;
  readonly log: (line: string) => void;
  /** told each judged mutant's seconds (its plant, run and restore), for --costs-out. */
  readonly cost?: (name: string, seconds: number) => void;
  /** Milliseconds, for `cost`; Date.now when absent. */
  readonly clock?: () => number;
};

export type MutateResult = { readonly code: 0 | 1 | 2; readonly killed: number; readonly survived: number };

/**
 * One slice of the set, for a release that runs it in parallel jobs: shard
 * `index` of `count` (1-based). The slices of 1..count are disjoint and
 * together the whole list, whatever its length (test/mutants.test.ts holds the
 * real list to it).
 *
 * The slices are cut by COST, not by position: scripts/mutant-costs.tsv
 * holds the seconds each mutant's run took in a release, and `planShards`
 * deals the mutants, dearest first, to the shard that ends cheapest with it, a
 * shard paying a control run the first time it takes a mutant of that run.
 * Round-robin by position left v0.4.0's slowest shard at 45 minutes beside
 * three at 26, and every shard paid all 33 controls.
 */
export type Shard = { readonly index: number; readonly count: number };

/** `k/n` with integers 1 <= k <= n, or null. */
export function parseShard(raw: string): Shard | null {
  const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(raw);
  if (m === null) return null;
  const index = Number(m[1]);
  const count = Number(m[2]);
  return index <= count ? { index, count } : null;
}

/** Seconds per mutant name. */
export type Costs = ReadonlyMap<string, number>;

/**
 * scripts/mutant-costs.tsv: `<seconds>\t<mutant name>` a line; `#` lines and
 * blank lines are ignored. A malformed line, a negative or non-finite cost or
 * a name given twice throws: a cost file that cannot be read is a refusal,
 * never a silent fallback.
 */
export function parseCosts(text: string): Map<string, number> {
  const out = new Map<string, number>();
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "" || line.startsWith("#")) return;
    const tab = line.indexOf("\t");
    const seconds = tab > 0 ? Number(line.slice(0, tab)) : Number.NaN;
    const name = tab > 0 ? line.slice(tab + 1) : "";
    if (!Number.isFinite(seconds) || seconds < 0 || name === "") throw new Error(`mutant costs line ${String(i + 1)}: expected <seconds>\\t<name>, got ${JSON.stringify(line)}`);
    if (out.has(name)) throw new Error(`mutant costs line ${String(i + 1)}: ${JSON.stringify(name)} is given twice`);
    out.set(name, seconds);
  });
  return out;
}

/** The cost file's text: sorted by name, one decimal, so a regenerated file diffs by line. */
export function formatCosts(costs: Costs): string {
  const names = [...costs.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `# seconds\tmutant (npm run mutate -- --costs-out; regenerated at each release)\n${names.map((n) => `${(costs.get(n) ?? 0).toFixed(1)}\t${n}`).join("\n")}\n`;
}

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 1;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  const at = (i: number): number => v[i] ?? 0;
  return v.length % 2 === 1 ? at(mid) : (at(mid - 1) + at(mid)) / 2;
};

const runKey = (m: Mutant, defaults: { readonly tests: readonly string[] }): string => JSON.stringify([m.config ?? null, m.tests ?? defaults.tests]);

export type ShardPlan = {
  /** The shard (0-based) of the mutant at each position. */
  readonly assign: readonly number[];
  /** Each shard's planned seconds: its mutants and its control runs. */
  readonly loads: readonly number[];
};

/**
 * The cost-balanced cut. A mutant costs its seconds in `costs`, or, missing
 * there (a new mutant), the median of the file's costs of the listed mutants;
 * a control run costs the median of its run's mutants. Mutants are dealt
 * dearest first (equal costs by position), each to the shard whose load after
 * taking it is least (equal loads to the lowest shard): one cut for a given
 * list and file, on every machine.
 */
export function planShards(mutants: readonly Mutant[], count: number, costs: Costs, defaults: { readonly tests: readonly string[] }): ShardPlan {
  const known = mutants.flatMap((m) => {
    const c = costs.get(m.name);
    return c === undefined ? [] : [c];
  });
  const fallback = median(known);
  const items = mutants.map((m, i) => ({ i, run: runKey(m, defaults), cost: costs.get(m.name) ?? fallback }));
  const byRun = new Map<string, number[]>();
  for (const it of items) byRun.set(it.run, [...(byRun.get(it.run) ?? []), it.cost]);
  const control = new Map([...byRun].map(([k, v]) => [k, median(v)] as const));
  const shards = Array.from({ length: count }, () => ({ load: 0, runs: new Set<string>() }));
  const assign = Array.from({ length: mutants.length }, () => 0);
  for (const it of [...items].sort((a, b) => b.cost - a.cost || a.i - b.i)) {
    let best = 0;
    let bestLoad = Infinity;
    shards.forEach((sh, s) => {
      const after = sh.load + it.cost + (sh.runs.has(it.run) ? 0 : (control.get(it.run) ?? 0));
      if (after < bestLoad) [best, bestLoad] = [s, after];
    });
    assign[it.i] = best;
    const chosen = shards[best];
    if (chosen !== undefined) {
      chosen.load = bestLoad;
      chosen.runs.add(it.run);
    }
  }
  return { assign, loads: shards.map((sh) => sh.load) };
}

/** The mutants of `shard`, in list order, as `planShards` cuts them. */
export function shardOf(mutants: readonly Mutant[], shard: Shard, costs: Costs, defaults: { readonly tests: readonly string[] }): Mutant[] {
  const { assign } = planShards(mutants, shard.count, costs, defaults);
  return mutants.filter((_, i) => assign[i] === shard.index - 1);
}

/** The distinct (config, tests) runs of the selected mutants, in first-seen order. */
export function controlRuns(mutants: readonly Mutant[], defaults: { readonly tests: readonly string[] }): Array<readonly [string | undefined, readonly string[]]> {
  const seen = new Map<string, readonly [string | undefined, readonly string[]]>();
  for (const m of mutants) {
    const run = [m.config, m.tests ?? defaults.tests] as const;
    seen.set(JSON.stringify([m.config ?? null, run[1]]), run);
  }
  return [...seen.values()];
}

/**
 * Runs the controls, then every mutant, restoring each file after its mutant
 * and on any way out. `originals` is the caller's, so it can restore the files
 * on an interrupt too.
 */
export function runMutants(mutants: readonly Mutant[], defaults: { readonly file: string; readonly tests: readonly string[] }, io: MutateIo, originals: Map<string, string> = new Map()): MutateResult {
  for (const [config, tests] of controlRuns(mutants, defaults)) {
    const under = config ?? "the unit config";
    if (io.run(config, tests) !== 0) {
      io.log(`✗ refused: ${tests.join(" ")} fails UNMUTATED under ${under}${config === undefined ? "" : " (TEST_DATABASE_URL and psql set?)"} — no mutant of it can be judged`);
      return { code: 2, killed: 0, survived: 0 };
    }
    io.log(`  control: ${tests.join(" ")} passes unmutated under ${under}`);
  }
  const restore = (): void => {
    for (const [f, s] of originals) io.write(f, s);
  };
  let survived = 0;
  let killed = 0;
  try {
    for (const m of mutants) {
      const file = m.file ?? defaults.file;
      const original = originals.get(file) ?? io.read(file);
      originals.set(file, original);
      // A pattern found more than once would plant its bug at the first match,
      // which need not be the place its name says (0309's GeoNames mutant
      // changed DELFI static's row): it is judged as a survivor, like one found
      // nowhere, and nothing is planted.
      const found = original.split(m.from).length - 1;
      if (found !== 1) {
        io.log(`  ? ${m.name}: the pattern ${found === 0 ? "no longer matches" : `matches ${String(found)} places of`} ${file} — fix the mutant`);
        survived += 1;
        continue;
      }
      // A function, so a `$$` in the replacement is two dollars and not a replacement pattern.
      const mutated = original.replace(m.from, () => m.to);
      if (mutated === original) {
        io.log(`  ? ${m.name}: the mutant changes nothing in ${file} — fix the mutant`);
        survived += 1;
        continue;
      }
      const t0 = (io.clock ?? Date.now)();
      io.write(file, mutated);
      const status = io.run(m.config, m.tests ?? defaults.tests);
      restore();
      io.cost?.(m.name, ((io.clock ?? Date.now)() - t0) / 1000);
      if (status === 0) {
        io.log(`  ✗ SURVIVED: ${m.name}`);
        survived += 1;
      } else {
        io.log(`  ✓ killed: ${m.name}`);
        killed += 1;
      }
    }
  } finally {
    restore();
  }
  io.log(`${survived === 0 ? "✓" : "✗"} mutants: ${String(killed)} killed, ${String(survived)} survived`);
  return { code: survived === 0 ? 0 : 1, killed, survived };
}
