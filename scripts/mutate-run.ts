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
};

export type MutateResult = { readonly code: 0 | 1 | 2; readonly killed: number; readonly survived: number };

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
      io.write(file, mutated);
      const status = io.run(m.config, m.tests ?? defaults.tests);
      restore();
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
