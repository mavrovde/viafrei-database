/**
 * ci-gate: may this commit be released? Yes only when every required
 * workflow's NEWEST run on the commit concluded `success`, and that run was a
 * push to main of this repository (a fork's run, a pull request's run or a
 * run on another branch is never evidence). A run still queued or in
 * progress is a refusal, not a wait.
 *
 *   node scripts/ci-gate.ts <sha> <owner/repo> < runs.json
 *
 * runs.json is `gh api --paginate --slurp "repos/R/actions/runs?head_sha=SHA&per_page=100"`.
 * Exit 0 = released may proceed; 1 = refused (the reason on stderr); 2 = unusable input.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The workflows whose jobs are the required checks (README of branch protection). */
export const REQUIRED_WORKFLOWS = [".github/workflows/ci.yml", ".github/workflows/security.yml"] as const;

export type Run = {
  readonly id: number;
  readonly path: string;
  readonly head_sha: string;
  readonly head_branch: string | null;
  readonly event: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly run_attempt?: number;
  readonly created_at: string;
  readonly head_repository?: { readonly full_name?: string } | null;
};

export type GateResult = { readonly ok: boolean; readonly lines: readonly string[] };

/** `--slurp` gives an array of pages, each `{ workflow_runs: [...] }`; a single page object is accepted too. */
export function runsOf(json: unknown): Run[] {
  const pages = Array.isArray(json) ? json : [json];
  const out: Run[] = [];
  for (const p of pages) {
    const runs = (p as { workflow_runs?: unknown } | null)?.workflow_runs;
    if (!Array.isArray(runs)) throw new Error("not a workflow-runs listing (no workflow_runs array)");
    out.push(...(runs as Run[]));
  }
  return out;
}

export function judgeCi(runs: readonly Run[], sha: string, repo: string, required: readonly string[] = REQUIRED_WORKFLOWS): GateResult {
  if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, lines: [`✗ '${sha.slice(0, 50)}' is not a 40-hex commit`] };
  const lines: string[] = [];
  let ok = true;
  for (const path of required) {
    const mine = runs
      .filter((r) => r.path === path && r.head_sha === sha && r.event === "push" && r.head_branch === "main" && r.head_repository?.full_name === repo)
      .sort((a, b) => (a.created_at === b.created_at ? (b.run_attempt ?? 1) - (a.run_attempt ?? 1) : a.created_at < b.created_at ? 1 : -1));
    const newest = mine[0];
    if (newest === undefined) {
      ok = false;
      lines.push(`✗ ${path}: no push-to-main run of ${repo} on ${sha.slice(0, 12)}`);
    } else if (newest.status !== "completed") {
      ok = false;
      lines.push(`✗ ${path}: run ${String(newest.id)} is ${newest.status}, not completed — a release never waits on a running check`);
    } else if (newest.conclusion !== "success") {
      ok = false;
      lines.push(`✗ ${path}: run ${String(newest.id)} concluded ${newest.conclusion ?? "nothing"}`);
    } else {
      lines.push(`✓ ${path}: run ${String(newest.id)} concluded success`);
    }
  }
  return { ok, lines };
}

function main(argv: readonly string[]): number {
  const [sha, repo] = argv;
  if (sha === undefined || repo === undefined || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    process.stderr.write("usage: node scripts/ci-gate.ts <sha> <owner/repo> < runs.json\n");
    return 2;
  }
  let runs: Run[];
  try {
    runs = runsOf(JSON.parse(readFileSync(0, "utf8")) as unknown);
  } catch (e) {
    process.stderr.write(`✗ the runs listing is unusable: ${(e as Error).message}\n`);
    return 2;
  }
  const r = judgeCi(runs, sha, repo);
  for (const l of r.lines) (r.ok ? process.stdout : process.stderr).write(`${l}\n`);
  return r.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
