/**
 * Mutation check of the head/readiness logic and of the schema coverage gate:
 * each mutant is one small, plausible bug in src/migrations/plan.ts or
 * scripts/coverage-schema.ts. The tests named for it must fail on every one of
 * them, or they do not guard what they claim to. The file is restored after
 * each mutant, also on an interrupted run.
 *
 *   npm run mutate
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const FILE = join(ROOT, "src", "migrations", "plan.ts");
const TESTS = ["test/plan.test.ts", "test/service.test.ts", "test/http.test.ts", "test/actions.test.ts"];

type Mutant = { readonly name: string; readonly from: string; readonly to: string; readonly file?: string; readonly tests?: readonly string[] };
const GATE = join(ROOT, "scripts", "coverage-schema.ts");
const GATE_TESTS = ["test/coverage-schema.test.ts"];
const MUTANTS: readonly Mutant[] = [
  { name: "an unreadable ledger counts as ready", from: 'if (state === null) return { ready: false, reason: "no-ledger"', to: 'if (state === null) return { ready: true, reason: "at-head", head: 0 }; if (Math.random() < 0) return { ready: false, reason: "no-ledger"' },
  { name: "an image without migrations is ready", from: "if (state.imageHead === 0)", to: "if (state.imageHead < 0)" },
  { name: "a mismatch does not block readiness", from: "if (state.mismatches.length > 0) {", to: "if (state.mismatches.length > 1) {" },
  { name: "pending files do not block readiness", from: "if (state.pending.length > 0) {", to: "if (state.pending.length > 1) {" },
  { name: "a file with another checksum counts as applied", from: "} else if (!acceptsChecksum(f, got)) {", to: "} else if (got === undefined) {" },
  { name: "a gap is not pending", from: "      pending.push(f);", to: "      if (f.version > rows.reduce((m, r) => Math.max(m, r.version), 0)) pending.push(f);" },
  { name: "the image head is the file count, not the highest version", from: "const imageHead = files.reduce((m, f) => Math.max(m, f.version), 0);", to: "const imageHead = files.length - 1;" },
  { name: "ahead versions block readiness", from: "const ahead = [...byVersion.keys()].filter((v) => !carried.has(v)).sort((a, b) => a - b);", to: "const ahead = [...byVersion.keys()].filter((v) => !carried.has(v)).sort((a, b) => a - b); if (ahead.length > 0 && files[0]) pending.push(files[0]);" },
  { name: "the partitions step is not required", from: 'if (steps.partitions === null) return { ready: false, detail: "partitions not ensured yet" };', to: "" },
  { name: "a failed partitions step counts as done", from: 'if (!steps.partitions) return { ready: false, detail: "partitions ensure failed" };', to: "" },
  { name: "the role step is not required", from: 'if (steps.roles === null) return { ready: false, detail: "role passwords not applied yet" };', to: "" },
  { name: "a failed role step counts as done", from: 'if (steps.roles === false) return { ready: false, detail: "a required role password could not be applied" };', to: "" },
  { name: "the schema is not required", from: "if (!schema.ready) return", to: "if (Math.random() < 0) return" },
  { name: "gate: an object without a row is not missing", file: GATE, tests: GATE_TESTS, from: "!named.has(key(o)) && !gapped.has(key(o)));", to: "false);" },
  { name: "gate: a row for no object is not stale", file: GATE, tests: GATE_TESTS, from: "manifest.filter((r) => !objects.has(key(r)));", to: "manifest.filter(() => false);" },
  { name: "gate: a row naming no test passes", file: GATE, tests: GATE_TESTS, from: "!(tests.get(r.file)?.has(r.title) ?? false)", to: "!tests.has(r.file)" },
  { name: "gate: the gap may keep a covered row", file: GATE, tests: GATE_TESTS, from: "objects.has(key(r)) && named.has(key(r))", to: "false" },
  { name: "gate: the gap may keep a vanished row", file: GATE, tests: GATE_TESTS, from: "gap.filter((r) => !objects.has(key(r)));", to: "gap.filter(() => false);" },
  { name: "gate: an unreadable test tree is an error, not a refusal", file: GATE, tests: GATE_TESTS, from: "throw new Refusal(`the test listing could not read", to: "throw new Error(`the test listing could not read" },
  { name: "gate: a kind read as none passes", file: GATE, tests: GATE_TESTS, from: "if (!catalogue.some((o) => o.kind === k)) throw", to: "if (catalogue.length < 0) throw" },
  { name: "gate: an empty manifest passes", file: GATE, tests: GATE_TESTS, from: "if (manifest.length === 0) throw", to: "if (manifest.length < 0) throw" },
  { name: "gate: a malformed row is skipped", file: GATE, tests: GATE_TESTS, from: "throw new Refusal(`${where}:${String(i + 1)}: expected", to: "return; throw new Refusal(`${where}:${String(i + 1)}: expected" },
  { name: "gate: a test listing with no title passes", file: GATE, tests: GATE_TESTS, from: "if (out.size === 0 || n === 0) throw", to: "if (out.size < 0) throw" },
  { name: "gate: a title built at run time is listed", file: GATE, tests: GATE_TESTS, from: "|\\\\.|\\$(?!\\{))*)`)/g;", to: "|\\\\.|\\$)*)`)/g;" },
  { name: "gate: the ok verdict ignores unknown tests", file: GATE, tests: GATE_TESTS, from: "stale.length + unknownTests.length + staleGap.length", to: "stale.length + staleGap.length" },
];

const originals = new Map<string, string>();
const restore = (): void => {
  for (const [f, s] of originals) writeFileSync(f, s);
};
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});

let survived = 0;
let killed = 0;
try {
  for (const m of MUTANTS) {
    const file = m.file ?? FILE;
    const original = originals.get(file) ?? readFileSync(file, "utf8");
    originals.set(file, original);
    const mutated = original.replace(m.from, m.to);
    if (mutated === original) {
      console.log(`  ? ${m.name}: the pattern no longer matches ${file} — fix the mutant`);
      survived += 1;
      continue;
    }
    writeFileSync(file, mutated);
    const r = spawnSync("npx", ["vitest", "run", ...(m.tests ?? TESTS)], { cwd: ROOT, encoding: "utf8" });
    restore();
    if (r.status === 0) {
      console.log(`  ✗ SURVIVED: ${m.name}`);
      survived += 1;
    } else {
      console.log(`  ✓ killed: ${m.name}`);
      killed += 1;
    }
  }
} finally {
  restore();
}
console.log(`${survived === 0 ? "✓" : "✗"} mutants: ${String(killed)} killed, ${String(survived)} survived`);
process.exit(survived === 0 ? 0 : 1);
