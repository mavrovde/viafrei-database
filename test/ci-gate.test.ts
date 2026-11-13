import { describe, expect, it } from "vitest";
import { judgeCi, REQUIRED_WORKFLOWS, runsOf, type Run } from "../scripts/ci-gate.js";

const SHA = "a".repeat(40);
const REPO_ = "mavrovde/viafrei-database";
const run = (o: Partial<Run> & { path: string }): Run => ({
  id: 1,
  head_sha: SHA,
  head_branch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
  created_at: "2026-11-13T10:00:00Z",
  head_repository: { full_name: REPO_ },
  ...o,
});
const green = REQUIRED_WORKFLOWS.map((path, i) => run({ path, id: i + 1 }));

describe("judgeCi", () => {
  it("passes when every required workflow's newest push-to-main run succeeded", () => {
    expect(judgeCi(green, SHA, REPO_)).toEqual({ ok: true, lines: REQUIRED_WORKFLOWS.map((p, i) => `✓ ${p}: run ${String(i + 1)} concluded success`) });
  });

  it("refuses a missing workflow and names it", () => {
    const r = judgeCi(green.slice(0, 1), SHA, REPO_);
    expect(r.ok).toBe(false);
    expect(r.lines[1]).toBe(`✗ ${REQUIRED_WORKFLOWS[1]}: no push-to-main run of ${REPO_} on ${SHA.slice(0, 12)}`);
  });

  it.each<[string, Partial<Run>]>([
    ["a pull request's run", { event: "pull_request" }],
    ["another branch's run", { head_branch: "feature" }],
    ["a fork's run", { head_repository: { full_name: "someone/viafrei-database" } }],
    ["a run on another commit", { head_sha: "b".repeat(40) }],
  ])("never counts %s as evidence", (_n, o) => {
    const runs = [run({ path: REQUIRED_WORKFLOWS[0], ...o }), ...green.slice(1)];
    expect(judgeCi(runs, SHA, REPO_).ok).toBe(false);
  });

  it("judges the NEWEST run: a later failure beats an earlier success, a later re-run attempt beats its first", () => {
    const path = REQUIRED_WORKFLOWS[0];
    const later = run({ path, id: 9, conclusion: "failure", created_at: "2026-11-13T11:00:00Z" });
    expect(judgeCi([...green, later], SHA, REPO_).lines[0]).toBe(`✗ ${path}: run 9 concluded failure`);
    const rerun = run({ path, id: 1, run_attempt: 2, conclusion: "success" });
    const first = run({ path, id: 1, run_attempt: 1, conclusion: "failure" });
    expect(judgeCi([first, rerun, ...green.slice(1)], SHA, REPO_).ok).toBe(true);
  });

  it("refuses a run still in progress instead of waiting", () => {
    const r = judgeCi([run({ path: REQUIRED_WORKFLOWS[0], status: "in_progress", conclusion: null }), ...green.slice(1)], SHA, REPO_);
    expect(r.lines[0]).toContain("is in_progress, not completed");
  });

  it("refuses a sha that is not 40 hex", () => {
    expect(judgeCi(green, "v1.2.3", REPO_)).toEqual({ ok: false, lines: ["✗ 'v1.2.3' is not a 40-hex commit"] });
  });
});

describe("runsOf", () => {
  it("reads --slurp pages and a single page", () => {
    expect(runsOf([{ workflow_runs: [green[0]] }, { workflow_runs: [green[1]] }])).toEqual(green);
    expect(runsOf({ workflow_runs: green })).toEqual(green);
  });
  it("refuses anything else", () => {
    expect(() => runsOf({ message: "Not Found" })).toThrow("no workflow_runs array");
    expect(() => runsOf(null)).toThrow("no workflow_runs array");
  });
});
