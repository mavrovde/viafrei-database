/**
 * scripts/approve-release-runs.sh behind a gh stub on PATH: which runs it
 * approves (only this repository's, on the release branch, started by
 * github-actions[bot], waiting for approval), when it refuses (a branch that
 * is not release-please's), and that it gives up at the deadline. Each rule is
 * also removed from a copy of the script, and the case must then fail.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";

const REPO_NAME = "mavrovde/viafrei-database";
const BRANCH = "release-please--branches--main";
const SHA = "a".repeat(40);
const SCRIPT = join(REPO, "scripts", "approve-release-runs.sh");
const source = readFileSync(SCRIPT, "utf8");

const dir = mkdtempSync(join(tmpdir(), "vf-approve-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The stub answers the three calls the script makes: the branch head, the run
// listing (empty for the first STUB_EMPTY_READS reads) and an approval, which
// it records.
const bin = join(dir, "bin");
mkdirSync(bin);
writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
set -euo pipefail
args="$*"
case $args in
  *"-X POST "*"/approve"*) id=\${args%/approve*}; echo "\${id##*/}" >> "$STUB_LOG" ;;
  *"/branches/"*) echo "$STUB_SHA" ;;
  *"/actions/runs?"*)
    n=$(cat "$STUB_COUNT" 2>/dev/null || echo 0); echo $((n + 1)) > "$STUB_COUNT"
    if (( n < \${STUB_EMPTY_READS:-0} )); then echo '{"workflow_runs":[]}'; else cat "$STUB_RUNS"; fi ;;
  *) echo "unexpected gh $args" >&2; exit 9 ;;
esac
`,
);
chmodSync(join(bin, "gh"), 0o755);

interface Run {
  id: number;
  name?: string;
  conclusion?: string | null;
  repo?: string;
  branch?: string;
  actor?: string;
}
const run = (r: Run): object => ({
  id: r.id,
  name: r.name ?? "CI",
  status: r.conclusion === null ? "in_progress" : "completed",
  conclusion: r.conclusion === undefined ? "action_required" : r.conclusion,
  head_branch: r.branch ?? BRANCH,
  head_repository: { full_name: r.repo ?? REPO_NAME },
  actor: { login: r.actor ?? "github-actions[bot]" },
});

let n = 0;
/** Runs a script text against a run listing; returns its exit code, its output and the run ids it approved. */
function approve(script: string, runs: Run[], opts: { branch?: string | undefined; wait?: string | undefined; emptyReads?: number; timeout?: number } = {}): { code: number | null; out: string; approved: number[] } {
  const case_ = join(dir, `case-${String(++n)}`);
  mkdirSync(case_);
  const path = join(case_, "approve.sh");
  writeFileSync(path, script);
  writeFileSync(join(case_, "runs.json"), JSON.stringify({ workflow_runs: runs.map(run) }));
  const r = spawnSync("bash", [path, opts.branch ?? BRANCH], {
    env: {
      PATH: `${bin}:${process.env["PATH"] ?? ""}`,
      GH_REPO: REPO_NAME,
      APPROVE_WAIT_S: opts.wait ?? "5",
      APPROVE_POLL_S: "0.05",
      STUB_SHA: SHA,
      STUB_RUNS: join(case_, "runs.json"),
      STUB_LOG: join(case_, "approved"),
      STUB_COUNT: join(case_, "count"),
      STUB_EMPTY_READS: String(opts.emptyReads ?? 0),
    },
    encoding: "utf8",
    timeout: opts.timeout ?? 1500,
  });
  const log = join(case_, "approved");
  const approved = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter((l) => l !== "").map(Number) : [];
  return { code: r.status, out: `${r.stdout}${r.stderr}`, approved };
}

/** A copy of the script with one rule taken out; the removal must change the text. */
function without(rule: string | RegExp, by = ""): string {
  const m = source.replace(rule, by);
  if (m === source) throw new Error(`the mutation of ${String(rule)} changed nothing`);
  return m;
}

const own: Run[] = [{ id: 1 }, { id: 2, name: "Security" }];

// Each case: the runs, and what a correct script does with them.
const cases: Record<string, { runs: Run[]; ok: (r: ReturnType<typeof approve>) => boolean; branch?: string; wait?: string; mutant: string }> = {
  "refuses a branch that is not release-please's (exit 2)": {
    // Runs on main as well, so a script without the refusal approves them and exits 0.
    runs: [{ id: 1, branch: "main" }, { id: 2, name: "Security", branch: "main" }],
    branch: "main",
    ok: (r) => r.code === 2 && r.approved.length === 0 && r.out.includes("is not a release-please branch"),
    mutant: without(/^\[\[ \$branch == release-please--\* \]\][^\n]*\n/m),
  },
  "approves no run from a fork": {
    runs: [...own, { id: 3, repo: "someone/viafrei-database" }],
    ok: (r) => r.code === 0 && r.approved.join() === "1,2",
    mutant: without(" and .head_repository.full_name == $repo"),
  },
  "approves only runs waiting for approval": {
    runs: [...own, { id: 4, conclusion: "success" }, { id: 5, name: "Security", conclusion: null }],
    ok: (r) => r.code === 0 && r.approved.join() === "1,2",
    mutant: without("select(.conclusion == \"action_required\") | ", ""),
  },
  "approves no run on another branch": {
    runs: [...own, { id: 6, branch: "feature" }],
    ok: (r) => r.code === 0 && r.approved.join() === "1,2",
    mutant: without(" and .head_branch == $branch"),
  },
  "approves no run started by anyone but github-actions[bot]": {
    runs: [...own, { id: 7, actor: "someone" }],
    ok: (r) => r.code === 0 && r.approved.join() === "1,2",
    mutant: without(' and .actor.login == "github-actions[bot]"'),
  },
  "fails at the deadline when a workflow has no run (exit 1)": {
    runs: [{ id: 1 }],
    wait: "0",
    ok: (r) => r.code === 1 && r.out.includes("no pull_request run of Security") && r.approved.join() === "1",
    mutant: without(/^ {4}\(\( SECONDS < deadline \)\)[^\n]*\n/m),
  },
};

describe("approve-release-runs.sh", () => {
  for (const [name, c] of Object.entries(cases)) {
    it(name, () => {
      const r = approve(source, c.runs, { branch: c.branch, wait: c.wait });
      expect(c.ok(r), r.out).toBe(true);
    });
    it(`${name}: goes red with the rule removed`, () => {
      const r = approve(c.mutant, c.runs, { branch: c.branch, wait: c.wait, timeout: 800 });
      expect(c.ok(r), r.out).toBe(false);
    });
  }

  it("waits for runs that appear later, within the deadline", () => {
    const r = approve(source, own, { emptyReads: 3 });
    expect(r.code, r.out).toBe(0);
    expect(r.approved).toEqual([1, 2]);
  });

  it("runs in strict mode, and makes no gh call the stub does not know", () => {
    expect(source).toContain("set -euo pipefail\n");
    expect(approve(source, own).out).not.toContain("unexpected gh");
  });
});
