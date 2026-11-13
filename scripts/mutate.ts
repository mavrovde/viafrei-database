/**
 * Mutation check of the head/readiness logic: each mutant is one small,
 * plausible bug in src/migrations/plan.ts. The plan and service tests must
 * fail on every one of them, or they do not guard what they claim to. The
 * file is restored after each mutant, also on an interrupted run.
 *
 *   npm run mutate
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const FILE = join(ROOT, "src", "migrations", "plan.ts");
const TESTS = ["test/plan.test.ts", "test/service.test.ts", "test/http.test.ts", "test/actions.test.ts"];

type Mutant = { readonly name: string; readonly from: string; readonly to: string };
const MUTANTS: readonly Mutant[] = [
  { name: "an unreadable ledger counts as ready", from: 'if (state === null) return { ready: false, reason: "no-ledger"', to: 'if (state === null) return { ready: true, reason: "at-head", head: 0 }; if (Math.random() < 0) return { ready: false, reason: "no-ledger"' },
  { name: "an image without migrations is ready", from: "if (state.imageHead === 0)", to: "if (state.imageHead < 0)" },
  { name: "a mismatch does not block readiness", from: "if (state.mismatches.length > 0) {", to: "if (state.mismatches.length > 1) {" },
  { name: "pending files do not block readiness", from: "if (state.pending.length > 0) {", to: "if (state.pending.length > 1) {" },
  { name: "a file with another checksum counts as applied", from: "} else if (got !== f.checksum) {", to: "} else if (got === undefined) {" },
  { name: "a gap is not pending", from: "      pending.push(f);", to: "      if (f.version > rows.reduce((m, r) => Math.max(m, r.version), 0)) pending.push(f);" },
  { name: "the image head is the file count, not the highest version", from: "const imageHead = files.reduce((m, f) => Math.max(m, f.version), 0);", to: "const imageHead = files.length - 1;" },
  { name: "ahead versions block readiness", from: "const ahead = [...byVersion.keys()].filter((v) => !carried.has(v)).sort((a, b) => a - b);", to: "const ahead = [...byVersion.keys()].filter((v) => !carried.has(v)).sort((a, b) => a - b); if (ahead.length > 0 && files[0]) pending.push(files[0]);" },
  { name: "the partitions step is not required", from: 'if (steps.partitions === null) return { ready: false, detail: "partitions not ensured yet" };', to: "" },
  { name: "a failed partitions step counts as done", from: 'if (!steps.partitions) return { ready: false, detail: "partitions ensure failed" };', to: "" },
  { name: "the role step is not required", from: 'if (steps.roles === null) return { ready: false, detail: "role passwords not applied yet" };', to: "" },
  { name: "a failed role step counts as done", from: 'if (steps.roles === false) return { ready: false, detail: "a required role password could not be applied" };', to: "" },
  { name: "the schema is not required", from: "if (!schema.ready) return", to: "if (Math.random() < 0) return" },
];

const original = readFileSync(FILE, "utf8");
const restore = (): void => writeFileSync(FILE, original);
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});

let survived = 0;
let killed = 0;
try {
  for (const m of MUTANTS) {
    const mutated = original.replace(m.from, m.to);
    if (mutated === original) {
      console.log(`  ? ${m.name}: the pattern no longer matches plan.ts — fix the mutant`);
      survived += 1;
      continue;
    }
    writeFileSync(FILE, mutated);
    const r = spawnSync("npx", ["vitest", "run", ...TESTS], { cwd: ROOT, encoding: "utf8" });
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
