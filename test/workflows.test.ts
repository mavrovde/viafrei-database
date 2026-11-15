/**
 * The release rules, read off the workflow files themselves: an image is
 * published for a confirmed release only, with the pins and the permissions
 * the release was reviewed with. Text-based on purpose: no YAML library, and
 * every assertion names the line it depends on.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { badgeFault, badgeLines, readTotals } from "../scripts/coverage-summary.js";
import { REPO } from "./helpers.js";

const WF = join(REPO, ".github", "workflows");
const release = readFileSync(join(WF, "release.yml"), "utf8");
const releasePlease = readFileSync(join(WF, "release-please.yml"), "utf8");
const workflows = readdirSync(WF).filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"));

/** The text of one job: from `  <id>:` to the next job or the end. */
function job(text: string, id: string): string {
  const jobs = text.slice(text.indexOf("\njobs:\n"));
  const start = jobs.indexOf(`\n  ${id}:\n`);
  if (start < 0) throw new Error(`no job '${id}'`);
  const rest = jobs.slice(start + 1);
  const next = /\n {2}[a-z][\w-]*:\n/.exec(rest.slice(1));
  return next === null ? rest : rest.slice(0, next.index + 1);
}

/** A job's `permissions:` block as "key: value" lines. */
function permissions(jobText: string): string[] {
  const m = /\n {4}permissions:\n((?: {6}[\w-]+: \w+.*\n)+)/.exec(jobText);
  if (m?.[1] === undefined) throw new Error("no permissions block");
  return m[1]
    .trimEnd()
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim());
}

const env = (name: string): string => {
  const m = new RegExp(`\\n {2}${name}: (.+)\\n`).exec(release);
  if (m?.[1] === undefined) throw new Error(`no workflow env ${name}`);
  return m[1];
};

describe("an image only for a confirmed release", () => {
  it("there is no workflow publishing an image for a branch or a commit", () => {
    expect(existsSync(join(WF, "image.yml"))).toBe(false);
    for (const n of workflows.filter((w) => w !== "release.yml")) {
      const t = readFileSync(join(WF, n), "utf8");
      expect(t, n).not.toMatch(/packages: write/);
      expect(t, n).not.toMatch(/push: true/);
      expect(t, n).not.toMatch(/ghcr\.io\/mavrovde/);
    }
  });

  it("runs on a tag push or started on a tag (workflow_dispatch, no inputs), and nothing else", () => {
    const on = /\non:\n([^]*?)\n(?=[a-z])/.exec(release)?.[1] ?? "";
    expect([...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1])).toEqual(["push", "workflow_dispatch"]);
    expect(on.startsWith('  push:\n    tags: ["v*"]\n')).toBe(true);
    expect(on).toMatch(/\n {2}workflow_dispatch:\n$/);
    expect(release).not.toMatch(/branches:|pull_request|schedule:|workflow_run|workflow_call|inputs\./);
  });

  it("publishes only for vX.Y.Z with no suffix", () => {
    const m = /if \[\[ ! \$TAG =~ (\S+) \]\]; then/.exec(job(release, "gate"));
    expect(m?.[1]).toBe("^v([0-9]+)\\.([0-9]+)\\.([0-9]+)$");
    const re = new RegExp(m?.[1] ?? "$^");
    for (const t of ["v0.1.0", "v1.2.3", "v10.20.30"]) expect(re.test(t), t).toBe(true);
    for (const t of ["v1.2.3-rc.1", "v1.2.3rc1", "v1.2", "1.2.3", "v1.2.3.4", "v1.2.3+build", "release-1.2.3"]) expect(re.test(t), t).toBe(false);
    expect(job(release, "gate")).toContain('echo "publish=false" >> "$GITHUB_OUTPUT"\n            exit 0');
  });

  it("checks the tag is annotated, equals package.json and is on main, and that CI passed on it", () => {
    const gate = job(release, "gate");
    expect(gate).toContain('[[ $(gh api "repos/$GH_REPO/git/ref/tags/$TAG" --jq .object.type) == tag ]]');
    expect(gate).toContain("pkg=$(jq -r .version package.json)");
    expect(gate).toContain('[[ $pkg == "$version" ]]');
    expect(gate).toContain('git merge-base --is-ancestor "$TAG^{commit}" origin/main');
    expect(gate).toContain('node scripts/ci-gate.ts "$SHA" "$GH_REPO" < "$RUNNER_TEMP/runs.json"');
  });

  it("publishes nothing unless the gate said so, and verifies only what it published", () => {
    expect(job(release, "publish")).toContain("\n    needs: [gate, mutants, snyk]\n    if: needs.gate.outputs.publish == 'true'\n");
    expect(job(release, "verify")).toContain("\n    needs: [gate, publish]\n");
    expect(job(release, "tag")).toContain("\n    needs: [gate, publish, verify]\n");
  });

  it("runs every mutant on the gate's commit before anything is built, and only here", () => {
    expect(mutantsFaults(release)).toEqual([]);
    expect(mutantsFaults(release.replace("    needs: [gate, mutants, snyk]\n", "    needs: [gate, snyk]\n"))).toEqual(["publish does not wait for the mutation check"]);
    expect(mutantsFaults(release.replace("        run: npm run mutate\n", "        run: npm run mutate -- --only lint\n"))).toEqual(["the mutation check does not run every mutant"]);
    expect(mutantsFaults(release.replace(/(\n {2}mutants:\n[^]*?)\n {4}if: needs\.gate\.outputs\.publish == 'true'\n/, "$1\n"))).toEqual(["the mutation check does not run on the gate's say-so"]);
    expect(mutantsFaults(release.replace("    timeout-minutes: 120\n", "    timeout-minutes: 120\n    continue-on-error: true\n"))).toEqual(["the mutation check may fail without failing the release"]);
    expect(job(release, "mutants")).toContain("\n    timeout-minutes: 120\n");
    // The full set runs in this file alone: no pull request, push or schedule runs it.
    for (const n of workflows.filter((w) => w !== "release.yml")) expect(readFileSync(join(WF, n), "utf8"), n).not.toContain("npm run mutate");
  });

  it("verifies the attestation and smokes the digest in the verify job, which the tag job waits for", () => {
    expect(verifyFaults(release)).toEqual([]);
  });

  it("a planted removal of the attestation check, the smoke or the wait goes red", () => {
    expect(verifyFaults(release.replace(/ {6}- name: gh attestation verify\n[^]*?--source-digest "\$COMMIT"\n/, ""))).toEqual(["verify does not run gh attestation verify on the digest"]);
    expect(verifyFaults(release.replace(' --source-digest "$COMMIT"', ""))).toEqual(["verify does not run gh attestation verify on the digest"]);
    expect(verifyFaults(release.replace('--source-ref "$GITHUB_REF"', '--source-ref "refs/heads/main"'))).toEqual(["verify does not run gh attestation verify on the digest"]);
    expect(verifyFaults(release.replace(" --signer-workflow mavrovde/viafrei-database/.github/workflows/release.yml", ""))).toEqual(["verify does not run gh attestation verify on the digest"]);
    expect(verifyFaults(release.replace(/ {6}- name: cosign verify-attestation[^\n]*\n[^]*?> \/dev\/null\n/, ""))).toEqual(["verify does not check the SBOM attestation"]);
    expect(verifyFaults(release.replace(/ {6}- name: Smoke the published digest[^\n]*\n[^]*?scripts\/image-smoke\.sh\n/, ""))).toEqual(["verify does not smoke the published digest"]);
    expect(verifyFaults(release.replace("\n    needs: [gate, publish, verify]\n", "\n    needs: [gate, publish]\n"))).toEqual(["the tag job does not wait for verify"]);
  });

  it("pushes by digest only; a tag is created after sign, attest and verify, never before", () => {
    const p = job(release, "publish");
    const push = p.slice(p.indexOf("      - id: build\n"));
    expect(push).toContain("outputs: type=image,name=${{ env.IMAGE }},push-by-digest=true,name-canonical=true,push=true\n");
    // The one tags: line in publish is the local check build's, which is loaded and never pushed.
    expect([...p.matchAll(/\n {10}tags: (.*)\n/g)].map((m) => m[1])).toEqual(["viafrei-database:release-check"]);
    expect(p).not.toMatch(/push: true|:latest|imagetools create/);
    expect(p.indexOf("cosign sign")).toBeGreaterThan(p.indexOf("      - id: build\n"));
    // Only the tag job names a tag on the registry, and it does so from the verified digest.
    for (const id of ["gate", "publish", "verify"]) expect(job(release, id), id).not.toMatch(/imagetools create|\$IMAGE:latest|\$IMAGE:\$MINOR/);
    const t = job(release, "tag");
    expect(t).toContain('docker buildx imagetools create "${args[@]}" "$IMAGE@$DIGEST"');
    expect(t).toContain("DIGEST: ${{ needs.publish.outputs.digest }}");
    expect(t).toContain('[[ $got == "$DIGEST" ]]');
    expect(t.indexOf('scripts/ghcr-not-released.sh "$IMAGE" "$VERSION"')).toBeLessThan(t.indexOf("imagetools create"));
    // The workflow's last job publishes the release page, after the tag job.
    expect(release.slice(release.indexOf("\n  release-page:\n") + 1)).toBe(job(release, "release-page"));
    expect(job(release, "release-page")).toContain("\n    needs: [gate, publish, tag]\n");
  });

  it("checks the image's version and schema head, never re-tags, builds both platforms, signs and attests", () => {
    const p = job(release, "publish");
    expect(p).toContain('want="viafrei-database $VERSION schema-head $HEAD"');
    expect(p).toContain('run: scripts/ghcr-not-released.sh "$IMAGE" "$VERSION"');
    expect(p.indexOf("scripts/ghcr-not-released.sh")).toBeLessThan(p.indexOf("      - id: build\n"));
    expect(p).toContain("platforms: linux/amd64,linux/arm64");
    expect(p).toContain("provenance: mode=max");
    expect(p).toContain('cosign sign --yes "$IMAGE@$DIGEST"');
    expect(p).toContain("format: spdx-json");
    expect(p).toContain("cosign attest --yes --type spdxjson");
    for (const l of ["version", "revision", "source"]) expect(p).toContain(`org.opencontainers.image.${l}=`);
    expect(p).not.toMatch(/de\.viafrei\.tenant/);
  });

  it("the verification identity accepts release.yml of this repository on a version tag only", () => {
    const re = new RegExp(env("IDENTITY"));
    const base = "https://github.com/mavrovde/viafrei-database/.github/workflows/";
    expect(re.test(`${base}release.yml@refs/tags/v1.2.3`)).toBe(true);
    for (const bad of [
      `${base}release.yml@refs/heads/main`,
      `${base}release.yml@refs/heads/v1.2.3`,
      `${base}release.yml@refs/pull/1/merge`,
      `${base}release-please.yml@refs/tags/v1.2.3`,
      `${base}release.yml@refs/tags/v1.2.3-rc.1`,
      `${base}ci.yml@refs/tags/v1.2.3`,
      "https://github.com/someone/viafrei-database/.github/workflows/release.yml@refs/tags/v1.2.3",
      `${base}release.yml@refs/tags/v1.2.3/x`,
      `${base}releaseXyml@refs/tags/v1.2.3`,
      `https://evil.example/${base}release.yml@refs/tags/v1.2.3`,
    ]) {
      expect(re.test(bad), bad).toBe(false);
    }
    expect(job(release, "verify")).toContain('--certificate-identity-regexp "$IDENTITY" --certificate-oidc-issuer "$ISSUER" --certificate-github-workflow-sha "$COMMIT"');
    expect(job(release, "verify")).toContain("COMMIT: ${{ needs.gate.outputs.commit }}");
    expect(env("ISSUER")).toBe("https://token.actions.githubusercontent.com");
  });

  it("the README tells users to verify against the same identity, and that the signing commit is on main", () => {
    const readme = readFileSync(join(REPO, "README.md"), "utf8");
    expect(readme.split(`--certificate-identity-regexp '${env("IDENTITY")}'`).length - 1).toBe(2);
    expect(readme).toContain("--output json | jq -r '.[0].optional.githubWorkflowSha')");
    expect(readme).toContain('gh api "repos/mavrovde/viafrei-database/compare/main...$sha" --jq .status   # must print identical or behind');
  });

  it("the README says which tag :latest follows, and SECURITY.md the tag ruleset and the first-release rule", () => {
    expect(readFileSync(join(REPO, "README.md"), "utf8")).toContain("A tag whose release failed still counts");
    const sec = readFileSync(join(REPO, "SECURITY.md"), "utf8");
    expect(sec).toContain("No one may move or delete a `v*` tag but a repository\n  administrator");
    expect(sec).toContain("scripts/ghcr-not-released.sh");
    const contributing = readFileSync(join(REPO, "CONTRIBUTING.md"), "utf8");
    // The one repository setting the release-please path needs, with why it is safe, and the recoveries.
    expect(contributing).toContain('"Allow GitHub Actions to\ncreate and approve pull requests")');
    expect(contributing).toContain("`main` requires 0 approving reviews");
    for (const r of ["`gh workflow run release.yml --ref vX.Y.Z`", "`gh run rerun <run-id> --failed`"]) expect(contributing).toContain(r);
  });
});

describe("permissions", () => {
  it("are read-only for the workflow and every job but publish, tag and release-page", () => {
    expect(release).toMatch(/\npermissions:\n {2}contents: read\n\n/);
    expect(permissions(job(release, "gate"))).toEqual(["contents: read", "actions: read"]);
    expect(permissions(job(release, "mutants"))).toEqual(["contents: read"]);
    // snyk.yml uploads its SARIF to code scanning, the one write a scan needs
    expect(permissions(job(release, "snyk"))).toEqual(["contents: read", "security-events: write"]);
    expect(permissions(job(release, "publish"))).toEqual(["contents: read", "packages: write", "id-token: write", "attestations: write"]);
    expect(permissions(job(release, "verify"))).toEqual(["contents: read", "packages: read", "attestations: read"]);
    expect(permissions(job(release, "tag"))).toEqual(["contents: read", "packages: write"]);
    expect(permissions(job(release, "release-page"))).toEqual(["contents: write"]);
  });

  it("release-please.yml grants each job what it uses, and nothing can publish an image", () => {
    expect(releasePlease).toMatch(/\npermissions:\n {2}contents: read\n\n/);
    expect(jobNamesById(releasePlease)).toEqual(["ready", "release-please", "approve", "tag"]);
    expect(permissions(job(releasePlease, "ready"))).toEqual(["contents: read", "actions: read"]);
    expect(permissions(job(releasePlease, "release-please"))).toEqual(["contents: write", "pull-requests: write"]);
    expect(permissions(job(releasePlease, "approve"))).toEqual(["contents: read", "actions: write"]);
    expect(permissions(job(releasePlease, "tag"))).toEqual(["contents: write", "actions: write"]);
    expect(releasePlease).not.toMatch(/packages: write|id-token: write|attestations: write/);
  });

  it("no expression is expanded inside a run script of any workflow (template injection)", () => {
    for (const n of workflows) {
      const lines = readFileSync(join(WF, n), "utf8").split("\n");
      let block = -1; // the indent of the `run:` key whose block we are in, or -1
      for (const l of lines) {
        const indent = l.length - l.trimStart().length;
        if (block >= 0 && (l.trim() === "" || indent > block)) {
          expect(l, `${n}: ${l}`).not.toMatch(/\$\{\{/);
          continue;
        }
        block = -1;
        const m = /^(\s*)(?:- )?run: (.*)$/.exec(l);
        if (m === null) continue;
        if (/^[|>]-?$/.test(m[2] ?? "")) block = (m[1] ?? "").length;
        else expect(m[2], `${n}: ${l}`).not.toMatch(/\$\{\{/);
      }
    }
  });
});

describe("pins", () => {
  // The versions the release was reviewed with; Dependabot proposes a change, a review accepts it here.
  const PINS: Record<string, string> = {
    "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/setup-node": "949feb2413d6458794dcd2491c4babbbce0c15c1",
    "docker/setup-qemu-action": "99012661954931238ded8c8b007157a8430204e1",
    "docker/setup-buildx-action": "f87e5991a6d7451dcb8d9637bfbc97413f497069",
    "docker/login-action": "8aa5831fb8d48d8f76594c7ddde61ae58019f550",
    "docker/build-push-action": "c3c9e263c25d99ce0380d002d59b67737d91b0dc",
    "sigstore/cosign-installer": "756fe2d284c7292c4e9b62c8a28f1e5629c59532",
    "actions/attest-build-provenance": "4d101475d8b20a2381f78447822ac1eab6504dd8",
    "anchore/sbom-action": "66cbf4bc1f1c0d2edc94016e65bc221b6bb0ad6c",
  };

  it("every action in every workflow is pinned by a full commit SHA", () => {
    for (const n of workflows) {
      for (const m of readFileSync(join(WF, n), "utf8").matchAll(/uses: (\S+)/g)) {
        // a workflow of this repository, called by its path, is pinned by the commit that runs it
        if ((m[1] ?? "").startsWith("./.github/workflows/")) continue;
        expect(m[1], `${n}: ${m[1] ?? ""}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      }
    }
  });

  it("release-please.yml uses exactly the reviewed pins", () => {
    const RP_PINS: Record<string, string> = {
      "actions/checkout": PINS["actions/checkout"] ?? "",
      "actions/setup-node": PINS["actions/setup-node"] ?? "",
      "googleapis/release-please-action": "45996ed1f6d02564a971a2fa1b5860e934307cf7", // v5.0.0
    };
    const used = [...releasePlease.matchAll(/uses: ([\w.-]+\/[\w.-]+)@([0-9a-f]{40})/g)].map((m) => [m[1] ?? "", m[2] ?? ""] as const);
    expect(new Set(used.map(([a]) => a))).toEqual(new Set(Object.keys(RP_PINS)));
    for (const [a, sha] of used) expect(sha, a).toBe(RP_PINS[a]);
  });

  it("the release uses exactly the reviewed pins", () => {
    const used = [...release.matchAll(/uses: ([\w.-]+\/[\w.-]+)@([0-9a-f]{40})/g)].map((m) => [m[1] ?? "", m[2] ?? ""] as const);
    expect(new Set(used.map(([a]) => a))).toEqual(new Set(Object.keys(PINS)));
    for (const [a, sha] of used) expect(sha, a).toBe(PINS[a]);
  });

  it("the setup-node version is the image's Node", () => {
    const node = /FROM node:([0-9.]+)-alpine/.exec(readFileSync(join(REPO, "Dockerfile"), "utf8"))?.[1];
    expect(node).toMatch(/^\d+\.\d+\.\d+$/);
    for (const n of workflows) for (const m of readFileSync(join(WF, n), "utf8").matchAll(/node-version: (\S+)/g)) expect(m[1], n).toBe(node);
  });
});

/** The mutation check: every mutant, on the gate's say-so, gating publish, never optional (its checkout: checkoutFaults). */
export function mutantsFaults(release: string): string[] {
  const m = job(release, "mutants");
  const faults: string[] = [];
  if (!/\n {4}needs: \[gate, mutants(, snyk)?\]\n/.test(job(release, "publish"))) faults.push("publish does not wait for the mutation check");
  if (!/\n {6}- name: Every mutant\n {8}env:\n {10}TEST_DATABASE_URL: \S+\n {8}run: npm run mutate\n/.test(m)) faults.push("the mutation check does not run every mutant");
  if (!m.includes("\n    needs: gate\n    if: needs.gate.outputs.publish == 'true'\n")) faults.push("the mutation check does not run on the gate's say-so");
  if (m.includes("continue-on-error")) faults.push("the mutation check may fail without failing the release");
  return faults;
}

/**
 * What the verify job must do to the pushed digest before the tag job may
 * point a tag at it: the provenance attestation checked and the image smoked.
 */
export function verifyFaults(release: string): string[] {
  const faults: string[] = [];
  const v = job(release, "verify");
  if (!v.includes('\n        run: gh attestation verify "oci://$IMAGE@$DIGEST" --repo "$GH_REPO" --signer-workflow mavrovde/viafrei-database/.github/workflows/release.yml --source-ref "$GITHUB_REF" --source-digest "$COMMIT"\n')) faults.push("verify does not run gh attestation verify on the digest");
  if (!v.includes('\n        run: cosign verify-attestation "$IMAGE@$DIGEST" --type spdxjson --certificate-identity-regexp "$IDENTITY" --certificate-oidc-issuer "$ISSUER" --certificate-github-workflow-sha "$COMMIT" > /dev/null\n')) faults.push("verify does not check the SBOM attestation");
  if (!v.includes("\n          IMAGE_REF: ${{ env.IMAGE }}@${{ needs.publish.outputs.digest }}\n        run: IMAGE=\"$IMAGE_REF\" scripts/image-smoke.sh\n")) faults.push("verify does not smoke the published digest");
  if (!job(release, "tag").includes("\n    needs: [gate, publish, verify]\n")) faults.push("the tag job does not wait for verify");
  return faults;
}

/** The ids of a workflow's jobs, in order. */
export function jobNamesById(text: string): string[] {
  const jobs = text.slice(text.indexOf("\njobs:\n"));
  return [...jobs.matchAll(/\n {2}([a-z][\w-]*):\n/g)].map((m) => m[1] ?? "");
}

/** Every job's `name:` in a workflow, in file order. */
export function jobNames(text: string): string[] {
  const jobs = text.slice(text.indexOf("\njobs:\n"));
  return [...jobs.matchAll(/\n {2}[a-z][\w-]*:\n {4}name: (.+)\n/g)].map((m) => (m[1] ?? "").trim());
}

/** The README's Checks table as "Workflow | Job" pairs. */
export function readmeChecks(readme: string): string[] {
  const at = readme.indexOf("\n## Checks\n");
  if (at < 0) return [];
  const section = readme.slice(at + 1, readme.indexOf("\n## ", at + 1));
  return [...section.matchAll(/^\| ([^|]+?) \| ([^|]+?) \| /gm)].map((m) => `${m[1] ?? ""} | ${m[2] ?? ""}`).filter((r) => r !== "Workflow | Job" && !r.startsWith("---"));
}

const THRESHOLD = (k: string): RegExp => new RegExp(`\\n\\s+${k}: (\\d+(?:\\.\\d+)?),\\n`);

/** What the coverage gate needs from vitest.coverage.config.ts: the four thresholds, each above zero. */
export function thresholdFaults(config: string): string[] {
  const at = config.indexOf("thresholds:");
  return ["lines", "branches", "functions", "statements"].flatMap((k) => {
    const m = at < 0 ? null : THRESHOLD(k).exec(config.slice(at));
    if (m === null) return [`${k}: no threshold`];
    return Number(m[1]) > 0 ? [] : [`${k}: threshold ${m[1] ?? ""} is not above zero`];
  });
}

/**
 * Every job after the gate builds, verifies and tags the commit the gate
 * judged, never whatever the tag names by then; the gate refuses a tag that no
 * longer names the commit the run was started for. One release runs at a time.
 */
export function checkoutFaults(release: string): string[] {
  const faults: string[] = [];
  for (const id of ["mutants", "publish", "verify", "tag"]) {
    const j = job(release, id);
    if (!j.includes("\n        with:\n          ref: ${{ needs.gate.outputs.commit }}\n")) faults.push(`${id} does not check out the gate's commit`);
    if (j.includes("ref: refs/tags/")) faults.push(`${id} checks out the tag ref`);
  }
  if (!job(release, "gate").includes('[[ $commit == "$GITHUB_SHA" ]] || {')) faults.push("the gate does not refuse a tag that has moved off github.sha");
  if (!release.includes("\nconcurrency:\n  group: release\n  cancel-in-progress: false\n")) faults.push("releases are not serialised in one group");
  return faults;
}

/** The gate's own refusal of a run that is not on a tag, word for word. */
export const GATE_REF_ERROR = "::error::release gate: this run is on $GITHUB_REF, not on a tag; start a release on its tag (gh workflow run release.yml --ref vX.Y.Z)";

/**
 * How release.yml binds every run to its tag, whatever started it: the run is
 * on refs/tags/<tag> (so github.sha, which the certificate records, is the
 * tag's commit), the tag still names github.sha, a non-vX.Y.Z tag is a quiet
 * no-op on a tag push only, and a page already published is refused.
 */
export function bindingFaults(release: string): string[] {
  const faults: string[] = [];
  const gate = job(release, "gate");
  if (!release.includes("\n  TAG: ${{ github.ref_name }}\n")) faults.push("the tag is not the ref the run is on");
  const steps = gate.slice(gate.indexOf("\n    steps:\n"));
  const first = steps.slice(steps.indexOf("\n      - "), steps.indexOf("\n      - ", steps.indexOf("\n      - ") + 1));
  if (!first.startsWith("\n      - name: The run is on its tag\n") || !first.includes(`[[ $GITHUB_REF == "refs/tags/$TAG" ]] || { echo "${GATE_REF_ERROR}"; exit 1; }`)) faults.push("the gate's first step does not refuse a run that is not on its tag");
  if (!gate.includes("[[ $GITHUB_EVENT_NAME == push ]] || {")) faults.push("a non-vX.Y.Z tag is a quiet no-op however the run started");
  if (!gate.includes('if page=$(gh api "repos/$GH_REPO/releases/tags/$TAG" --jq .html_url 2>&1); then\n')) faults.push("a published release page is not refused");
  const at = gate.indexOf('[[ $commit == "$GITHUB_SHA" ]] || {');
  if (at < 0 || gate.indexOf("echo \"publish=true\"") < at) faults.push("the gate says publish before it has bound the commit");
  return faults;
}

/**
 * What release-please.yml must do between the release commit and release.yml:
 * run only after CI and Security passed on main, then refuse a tag that is
 * not a plain vX.Y.Z or exists already, check CI on the release commit FIRST,
 * create an annotated tag on exactly that commit, and call release.yml with
 * release-please's tag and sha, never github.sha.
 */
export function releasePleaseFaults(rp: string, wf: (name: string) => string): string[] {
  const faults: string[] = [];
  const names = (/\n {4}workflows: \[(.*)\]\n/.exec(rp)?.[1] ?? "").split(", ");
  const actual = ["ci.yml", "security.yml"].map((n) => /\nname: (.+)\n/.exec(wf(n))?.[1] ?? "");
  if (names.join() !== actual.join() || !rp.includes("\n    types: [completed]\n    branches: [main]\n")) faults.push("it does not follow CI and Security on main");
  const ready = job(rp, "ready");
  if (!ready.includes("github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_repository.full_name == github.repository")) faults.push("a run that did not succeed on a push to this repository is followed");
  if (!ready.includes('node scripts/ci-gate.ts "$sha" "$GH_REPO" < "$RUNNER_TEMP/runs.json" || rc=$?')) faults.push("ready does not ask scripts/ci-gate.ts");
  if (!job(rp, "release-please").includes("\n    needs: ready\n    if: needs.ready.outputs.ready == 'true'\n")) faults.push("release-please runs before CI and Security both passed");
  const t = job(rp, "tag");
  if (!t.includes("\n    if: needs.release-please.outputs.created == 'true'\n")) faults.push("the tag job runs without a release");
  if (!t.includes("[[ $TAG =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+$ ]] || {")) faults.push("a tag that is not vX.Y.Z is not refused");
  if (!t.includes("[[ $SHA =~ ^[0-9a-f]{40}$ ]] || {")) faults.push("a commit that is not a 40-hex sha is not refused");
  const gate = t.indexOf('node scripts/ci-gate.ts "$SHA" "$GH_REPO" < "$RUNNER_TEMP/runs.json"\n');
  const exists = t.indexOf('if out=$(gh api "repos/$GH_REPO/git/ref/tags/$TAG" --jq .object.sha 2>&1); then\n');
  const create = t.indexOf('gh api -X POST "repos/$GH_REPO/git/tags"');
  if (gate < 0 || create < 0 || gate > create) faults.push("the tag is created before CI is checked on the release commit");
  if (exists < 0 || exists > create || !t.includes("*\"HTTP 404\"*")) faults.push("an existing tag is not refused");
  if (!t.includes('-f object="$SHA" -f type=commit') || !t.includes('-f ref="refs/tags/$TAG" -f sha="$obj"')) faults.push("the tag is not an annotated tag on the release commit");
  if (!t.includes('--jq .object.type) == tag ]]') || !t.includes('--jq .object.sha) == "$SHA" ]]')) faults.push("the tag is not read back");
  for (const id of jobNamesById(rp)) {
    const j = job(rp, id);
    const checkouts = j.split("uses: actions/checkout@").length - 1;
    if (checkouts > j.split("persist-credentials: false").length - 1) faults.push(`${id} keeps the checkout's credentials`);
  }
  const needsLine = /\n {4}needs: (?:\[(.*)\]|(\S+))\n/.exec(t);
  const needs = (needsLine?.[1] ?? needsLine?.[2] ?? "").split(", ").filter((x) => x !== "");
  if (needs.join() !== "release-please") faults.push("the tag job does not depend on the release-please action alone");
  const ids = jobNamesById(rp);
  for (const id of needs) if (ids.includes(id) && job(rp, id).includes("approve-release-runs.sh")) faults.push(`the tag job waits for the approval (in ${id})`);
  const approve = ids.includes("approve") ? job(rp, "approve") : "";
  if (!approve.includes("\n    needs: release-please\n    if: needs.release-please.outputs.pr != ''\n") || !approve.includes('scripts/approve-release-runs.sh "$branch"')) faults.push("the approval is not its own job after release-please");
  const dispatch = t.indexOf('\n          gh workflow run release.yml --ref "$TAG"\n');
  const readBack = t.indexOf('--jq .object.sha) == "$SHA" ]]');
  if (dispatch < 0) faults.push("release.yml is not started on the tag");
  else if (readBack < 0 || dispatch < readBack) faults.push("release.yml is started before the tag is read back");
  if (!t.includes('runs?event=workflow_dispatch&head_sha=$SHA') || !t.includes('select(.head_branch == \\"$TAG\\")') || !t.includes("(( SECONDS < deadline )) || {")) faults.push("the release run is not found within a bounded wait");
  if (!t.includes("              in_progress) break ;;\n") || !t.includes("[[ $conclusion != cancelled ]] || {")) faults.push("a release run that never started, or was cancelled, is accepted");
  if (!t.includes('\\"\\")\\"") || found=""\n')) faults.push("a failed read of the release runs ends the wait instead of being retried");
  if (/\n {4}uses: |workflow_call/.test(rp)) faults.push("release.yml is called rather than started on the tag");
  const out = job(rp, "release-please");
  if (!out.includes("\n      tag: ${{ steps.rp.outputs.tag_name }}\n      sha: ${{ steps.rp.outputs.sha }}\n")) faults.push("the tag and sha are not release-please's outputs");
  // A draft release has no tag, and release-please then counts from bootstrap-sha: the pull request
  // is built in a run of its own, only once the manifest's version has its tag.
  const rpStep = out.slice(out.indexOf("      - id: rp\n"), out.indexOf("\n      - ", out.indexOf("      - id: rp\n") + 1));
  if (!rpStep.includes("\n          skip-github-pull-request: true") || rpStep.includes("skip-github-release")) faults.push("the release pull request is built in the run that drafts a release");
  const prAt = out.indexOf("      - id: pr\n");
  const prStep = prAt < 0 ? "" : out.slice(prAt);
  if (!prStep.startsWith("      - id: pr\n        if: steps.tagged.outputs.tagged == 'true'\n        uses: googleapis/release-please-action@") || !prStep.includes("\n          skip-github-release: true\n") || !out.includes("\n      pr: ${{ steps.pr.outputs.pr }}\n")) faults.push("the release pull request is built before the released version is tagged");
  const tagged = out.indexOf("        id: tagged\n");
  if (tagged < 0 || tagged > prAt || !out.includes('"repos/$GH_REPO/contents/.release-please-manifest.json?ref=main"') || !out.includes('if out=$(gh api "repos/$GH_REPO/git/ref/tags/v$v" --jq .object.sha 2>&1); then\n            echo "tagged=true"')) faults.push("the released version's tag is not checked before the pull request");
  const refresh = t.indexOf("\n        run: gh workflow run release-please.yml --ref main");
  if (refresh < 0 || readBack < 0 || refresh < readBack) faults.push("the release pull request is not rebuilt once the tag exists");
  else if (dispatch >= 0 && refresh < dispatch) faults.push("release-please is started again before release.yml is started on the tag");
  if (refresh >= 0 && !t.includes('\n        run: gh workflow run release-please.yml --ref main || echo "::warning::could not start release-please again; the next push to main builds the release pull request"\n')) faults.push("a failed start of release-please fails the tag job after the release has started");
  if (!rp.includes("\nconcurrency:\n  group: release-please\n  cancel-in-progress: false\n")) faults.push("release-please runs are not serialised");
  return faults;
}

/** The last job: the draft gets the digest and the verify commands, and only then is published. */
export function releasePageFaults(release: string): string[] {
  const faults: string[] = [];
  const j = job(release, "release-page");
  if (!j.includes("[[ $draft == true ]] || {")) faults.push("a published release is edited");
  if (!j.includes('[[ $body != *"## Container image"* ]] || {')) faults.push("a draft is given a second image section");
  const notes = j.indexOf("} > \"$notes\"");
  const patch = j.indexOf('-F "body=@$notes" -F draft=false');
  if (notes < 0 || patch < notes) faults.push("the draft is published without the notes");
  if (!j.includes('-F draft=false -f make_latest="$HIGHEST"')) faults.push("the page is published without saying whether it is the latest");
  for (const want of ['"$IMAGE" "$DIGEST" "$IDENTITY" "$ISSUER" "$COMMIT"', '--source-ref %s --source-digest %s', "--type spdxjson"]) if (!j.includes(want)) faults.push(`the notes lack ${want}`);
  if (!j.includes('[[ $got == "$id false" ]] || {') || !j.includes('grep -qF "$DIGEST"')) faults.push("the published page is not read back");
  return faults;
}

/** The licences dependency review allows, against every licence in package-lock.json. */
export function licenceFaults(security: string, lock: { packages: Record<string, { license?: string }> }): string[] {
  const dr = job(security, "dependency-review");
  if (dr.includes("deny-licenses:")) return ["dependency review uses the deprecated deny-licenses"];
  const allowed = new Set((/\n {10}allow-licenses: (.+)\n/.exec(dr)?.[1] ?? "").split(",").map((l) => l.trim()).filter((l) => l !== ""));
  if (allowed.size === 0) return ["dependency review allows no licence list"];
  const used = new Set(Object.entries(lock.packages).filter(([p]) => p !== "").map(([, v]) => v.license ?? "(none)"));
  return [...used].filter((l) => !allowed.has(l)).sort().map((l) => `${l} is in the tree but not allowed`);
}

/** The runtime stage ships no npm or npx (scripts/image-smoke.sh checks the built image). */
export function runtimeFaults(dockerfile: string): string[] {
  const runtime = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
  if (!runtime.includes(" && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \\\n")) return ["the runtime stage still ships npm"];
  return [];
}

/** The Lint job runs actionlint, pinned by digest, over every workflow. */
export function actionlintFaults(ci: string): string[] {
  const lint = job(ci, "lint");
  if (!lint.includes('\n      - name: actionlint\n        run: docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9 -no-color\n')) return ["the Lint job does not run actionlint pinned by digest"];
  return [];
}

/** The coverage steps of the Integration tests (PostGIS) job, as CI must run them. */
export function coverageFaults(ci: string): string[] {
  const faults: string[] = [];
  const integ = job(ci, "integration");
  if (!integ.includes("\n        run: npm run coverage\n")) faults.push("the integration job does not run npm run coverage");
  if (integ.includes("\n        run: npm run test:db\n")) faults.push("the integration job still runs plain test:db");
  if (/\n {10}POSTGRES_DB:/.test(integ)) faults.push("the integration database is the image's POSTGRES_DB, not a plain create database");
  if (!integ.includes("-c 'create database viafrei_empty'\n")) faults.push("the integration job does not make its database with a plain create database");
  if (!integ.includes('VF_REQUIRE_DB: "1"')) faults.push("the coverage run may skip the database (no VF_REQUIRE_DB)");
  if (!integ.includes('node scripts/coverage-summary.ts coverage/coverage-summary.json >> "$GITHUB_STEP_SUMMARY"')) faults.push("no coverage summary in the job summary");
  if (!integ.includes("\n        run: node scripts/coverage-summary.ts --check-badge README.md coverage/coverage-summary.json\n")) faults.push("the coverage badge is not compared with the measurement");
  if (!/uses: actions\/upload-artifact@[0-9a-f]{40} # v\S+\n {8}with:\n {10}name: coverage\n {10}path: coverage\/\n/.test(integ)) faults.push("the coverage directory is not uploaded");
  return faults;
}

/** What SECURITY.md says starts each check, against the workflows' own triggers. */
export function triggerFaults(security: string, wf: (name: string) => string): string[] {
  const faults: string[] = [];
  const on = (text: string): string => /\non:\n([^]*?)\n(?=[a-z])/.exec(text)?.[1] ?? "";
  const ci = on(wf("ci.yml"));
  const sec = on(wf("security.yml"));
  const sc = on(wf("scorecard.yml"));
  if (ci.includes("schedule:") !== !security.includes("The CI workflow has no schedule.")) faults.push("SECURITY.md and ci.yml disagree about a CI schedule");
  if (!sec.includes("schedule:") || !sec.includes("pull_request:") || !/push:\n\s+branches: \[main\]/.test(sec)) faults.push("security.yml no longer runs on pull requests, pushes to main and weekly");
  if (!sc.includes("schedule:") || !sc.includes("branch_protection_rule:") || sc.includes("push:") || sc.includes("pull_request:")) faults.push("scorecard.yml no longer runs weekly and on a branch-protection change only");
  if (!job(wf("security.yml"), "dependency-review").includes("\n    if: github.event_name == 'pull_request'\n")) faults.push("dependency review is no longer pull-request only");
  if (!security.includes("| dependency review | Security | pull requests only")) faults.push("SECURITY.md does not say dependency review runs on pull requests only");
  if (!security.includes("| OpenSSF Scorecard | Scorecard | weekly and on a branch-protection change")) faults.push("SECURITY.md does not say when Scorecard runs");
  return faults;
}

describe("the release's checkouts and concurrency", () => {
  const release = readFileSync(join(WF, "release.yml"), "utf8");
  it("mutants, publish, verify and tag build from the gate's commit; the gate pins the tag to github.sha", () => {
    expect(checkoutFaults(release)).toEqual([]);
  });
  it("a checkout of the tag ref, a missing sha check or a per-tag group goes red", () => {
    const tagRef = release.replace("          ref: ${{ needs.gate.outputs.commit }}\n          persist-credentials: false\n", "          ref: refs/tags/${{ env.TAG }}\n          persist-credentials: false\n");
    expect(checkoutFaults(tagRef)).toEqual(["mutants does not check out the gate's commit", "mutants checks out the tag ref"]);
    expect(checkoutFaults(release.replace(/ {10}\[\[ \$commit == "\$GITHUB_SHA" \]\][^\n]*\n/, ""))).toEqual(["the gate does not refuse a tag that has moved off github.sha"]);
    expect(checkoutFaults(release.replace("  group: release\n", "  group: release-${{ github.ref_name }}\n"))).toEqual(["releases are not serialised in one group"]);
  });
});

describe("the release-please path", () => {
  const wf = (n: string): string => readFileSync(join(WF, n), "utf8");
  it("release.yml binds every run to its tag and the tag to github.sha", () => {
    expect(bindingFaults(release)).toEqual([]);
  });
  it("release-please.yml gates, tags and starts the release on the tag as it says", () => {
    expect(releasePleaseFaults(releasePlease, wf)).toEqual([]);
  });
  it("the release page is published last, with the digest and the verify commands", () => {
    expect(releasePageFaults(release)).toEqual([]);
  });
  it("a planted break of a binding goes red", () => {
    const cut = (re: RegExp): string => release.replace(re, "");
    expect(bindingFaults(release.replace("TAG: ${{ github.ref_name }}", "TAG: ${{ inputs.tag || github.ref_name }}"))).toEqual(["the tag is not the ref the run is on"]);
    const refStep = /( {6}# First, before anything[^]*?)( {6}- name: The run is on its tag\n[^]*?--ref vX\.Y\.Z\)"; exit 1; }\n)/;
    expect(refStep.test(release)).toBe(true);
    expect(bindingFaults(release.replace(refStep, "$1"))).toEqual(["the gate's first step does not refuse a run that is not on its tag"]);
    expect(bindingFaults(release.replace(GATE_REF_ERROR, "::error::not on a tag"))).toEqual(["the gate's first step does not refuse a run that is not on its tag"]);
    // After the checkout, a branch run would fail on a missing tag ref first, with checkout's message instead of the gate's.
    const checkout = /( {6}- uses: actions\/checkout@\S+ # v[\d.]+\n {8}with:\n {10}ref: refs\/tags\/\$\{\{ env\.TAG \}\}\n(?: {10}.*\n)+)/;
    const moved = release.replace(refStep, "$1").replace(checkout, (c) => c + (refStep.exec(release)?.[2] ?? ""));
    expect(moved).not.toBe(release);
    expect(bindingFaults(moved)).toEqual(["the gate's first step does not refuse a run that is not on its tag"]);
    expect(bindingFaults(release.replace("[[ $GITHUB_EVENT_NAME == push ]] || {", "true || {"))).toEqual(["a non-vX.Y.Z tag is a quiet no-op however the run started"]);
    expect(bindingFaults(cut(/ {10}if page=\$\(gh api[^]*? {10}fi\n/))).toEqual(["a published release page is not refused"]);
    expect(bindingFaults(cut(/ {10}\[\[ \$commit == "\$GITHUB_SHA" \]\][^\n]*\n/))).toEqual(["the gate says publish before it has bound the commit"]);
  });
  it("a planted break of release-please.yml goes red", () => {
    const rp = releasePlease;
    expect(releasePleaseFaults(rp.replace("workflows: [CI, Security]", "workflows: [CI]"), wf)).toEqual(["it does not follow CI and Security on main"]);
    expect(releasePleaseFaults(rp, (n) => (n === "security.yml" ? wf(n).replace("\nname: Security\n", "\nname: Security scans\n") : wf(n)))).toEqual(["it does not follow CI and Security on main"]);
    expect(releasePleaseFaults(rp.replace(" && github.event.workflow_run.event == 'push'", ""), wf)).toEqual(["a run that did not succeed on a push to this repository is followed"]);
    expect(releasePleaseFaults(rp.replace("    if: needs.ready.outputs.ready == 'true'\n", ""), wf)).toEqual(["release-please runs before CI and Security both passed"]);
    expect(releasePleaseFaults(rp.replace(/ {10}\[\[ \$TAG =~[^\n]*\n/, ""), wf)).toEqual(["a tag that is not vX.Y.Z is not refused"]);
    expect(releasePleaseFaults(rp.replace(/ {6}- name: CI and Security passed on the release commit\n[^]*?< "\$RUNNER_TEMP\/runs\.json"\n/, ""), wf)).toEqual(["the tag is created before CI is checked on the release commit"]);
    expect(releasePleaseFaults(rp.replace(/ {10}if out=\$\(gh api "repos\/\$GH_REPO\/git\/ref\/tags\/\$TAG"[^]*? {10}fi\n/, ""), wf)).toEqual(["an existing tag is not refused"]);
    expect(releasePleaseFaults(rp.replace('-f object="$SHA"', '-f object="$GITHUB_SHA"'), wf)).toEqual(["the tag is not an annotated tag on the release commit"]);
    expect(releasePleaseFaults(rp.replace('gh workflow run release.yml --ref "$TAG"', "gh workflow run release.yml"), wf)).toEqual(["release.yml is not started on the tag"]);
    expect(releasePleaseFaults(rp.replace('gh workflow run release.yml --ref "$TAG"', 'gh workflow run release.yml --ref main'), wf)).toEqual(["release.yml is not started on the tag"]);
    const dispatchLine = '          gh workflow run release.yml --ref "$TAG"\n';
    const early = rp.replace(dispatchLine, "").replace('          if out=$(gh api "repos/$GH_REPO/git/ref/tags/$TAG"', `${dispatchLine}          if out=$(gh api "repos/$GH_REPO/git/ref/tags/$TAG"`);
    expect(releasePleaseFaults(early, wf)).toEqual(["release.yml is started before the tag is read back"]);
    expect(releasePleaseFaults(rp.replace(/ {12}\(\( SECONDS < deadline \)\)[^\n]*\n/, ""), wf)).toEqual(["the release run is not found within a bounded wait"]);
    expect(releasePleaseFaults(rp.replace("              in_progress) break ;;\n", "              in_progress|queued|pending) break ;;\n"), wf)).toEqual(["a release run that never started, or was cancelled, is accepted"]);
    expect(releasePleaseFaults(rp.replace("[[ $conclusion != cancelled ]] || {", "true || {"), wf)).toEqual(["a release run that never started, or was cancelled, is accepted"]);
    expect(releasePleaseFaults(rp.replace(' || found=""\n', "\n"), wf)).toEqual(["a failed read of the release runs ends the wait instead of being retried"]);
    // The v0.1.1 defect: one action call both drafted the release and built the next pull request from bootstrap-sha.
    expect(releasePleaseFaults(rp.replace("          skip-github-pull-request: true\n", ""), wf)).toEqual(["the release pull request is built in the run that drafts a release"]);
    expect(releasePleaseFaults(rp.replace("        if: steps.tagged.outputs.tagged == 'true'\n", ""), wf)).toEqual(["the release pull request is built before the released version is tagged"]);
    expect(releasePleaseFaults(rp.replace("          skip-github-release: true\n", ""), wf)).toEqual(["the release pull request is built before the released version is tagged"]);
    expect(releasePleaseFaults(rp.replace("pr: ${{ steps.pr.outputs.pr }}", "pr: ${{ steps.rp.outputs.pr }}"), wf)).toEqual(["the release pull request is built before the released version is tagged"]);
    expect(releasePleaseFaults(rp.replace('/git/ref/tags/v$v"', '/git/ref/tags/v0.1.0"'), wf)).toEqual(["the released version's tag is not checked before the pull request"]);
    const refreshStep = /\n {6}- name: Build the next release pull request[^\n]*\n[^]*?--ref main[^\n]*\n/.exec(rp)?.[0] ?? "";
    expect(refreshStep).toContain("release-please.yml --ref main ||");
    expect(releasePleaseFaults(rp.replace(refreshStep, "\n"), wf)).toEqual(["the release pull request is not rebuilt once the tag exists"]);
    // Started before release.yml, a failed refresh would stop the tag job after the tag exists and before the release started.
    const startRelease = "\n      - name: Start release.yml on the tag, and see its run start\n";
    expect(releasePleaseFaults(rp.replace(refreshStep, "\n").replace(startRelease, refreshStep + startRelease.slice(1)), wf)).toEqual(["release-please is started again before release.yml is started on the tag"]);
    expect(releasePleaseFaults(rp.replace(' || echo "::warning::could not start release-please again; the next push to main builds the release pull request"', ""), wf)).toEqual(["a failed start of release-please fails the tag job after the release has started"]);
    const tagNeeds = "\n  tag:\n    name: Annotated tag\n    needs: release-please\n";
    expect(rp).toContain(tagNeeds);
    expect(releasePleaseFaults(rp.replace(tagNeeds, "\n  tag:\n    name: Annotated tag\n    needs: [release-please, approve]\n"), wf)).toEqual(["the tag job does not depend on the release-please action alone", "the tag job waits for the approval (in approve)"]);
    // The approval folded back into the release-please job: the tag job then waits for it.
    const approveSteps = job(rp, "approve").slice(job(rp, "approve").indexOf("    steps:\n") + "    steps:\n".length);
    const folded = rp.replace(job(rp, "approve"), "").replace("          skip-github-pull-request: true\n", `          skip-github-pull-request: true\n${approveSteps}`);
    expect(releasePleaseFaults(folded, wf)).toEqual(["the tag job waits for the approval (in release-please)", "the approval is not its own job after release-please"]);
    const appr = job(rp, "approve");
    expect(releasePleaseFaults(rp.replace(appr, appr.replace("persist-credentials: false", "persist-credentials: true")), wf)).toEqual(["approve keeps the checkout's credentials"]);
    expect(releasePleaseFaults(rp.replace(appr, appr.replace("    if: needs.release-please.outputs.pr != ''\n", "")), wf)).toEqual(["the approval is not its own job after release-please"]);
    expect(releasePleaseFaults(rp.replace("&head_sha=$SHA&", "&"), wf)).toEqual(["the release run is not found within a bounded wait"]);
    expect(releasePleaseFaults(`${rp}\n  release:\n    needs: tag\n    uses: ./.github/workflows/release.yml\n`, wf)).toEqual(["release.yml is called rather than started on the tag"]);
    expect(releasePleaseFaults(rp.replace("  group: release-please\n", "  group: release-please-${{ github.run_id }}\n"), wf)).toEqual(["release-please runs are not serialised"]);
    const tagJob = job(rp, "tag");
    expect(releasePleaseFaults(rp.replace(tagJob, tagJob.replace("persist-credentials: false", "persist-credentials: true")), wf)).toEqual(["tag keeps the checkout's credentials"]);
  });
  it("a planted break of the release page goes red", () => {
    expect(releasePageFaults(release.replace("[[ $draft == true ]] || {", "true || {"))).toEqual(["a published release is edited"]);
    expect(releasePageFaults(release.replace(' -F "body=@$notes"', ""))).toEqual(["the draft is published without the notes"]);
    expect(releasePageFaults(release.replace(" --source-ref %s --source-digest %s", " --source-ref %s"))).toEqual(["the notes lack --source-ref %s --source-digest %s"]);
    expect(releasePageFaults(release.replace('grep -qF "$DIGEST"', "true"))).toEqual(["the published page is not read back"]);
    expect(releasePageFaults(release.replace(' -f make_latest="$HIGHEST"', ""))).toEqual(["the page is published without saying whether it is the latest"]);
  });
});

describe("the licences dependency review allows", () => {
  const security = readFileSync(join(WF, "security.yml"), "utf8");
  const lock = JSON.parse(readFileSync(join(REPO, "package-lock.json"), "utf8")) as { packages: Record<string, { license?: string }> };
  it("cover every licence in the tree, with allow-licenses", () => {
    expect(licenceFaults(security, lock)).toEqual([]);
  });
  it("a licence outside the list, or deny-licenses, goes red", () => {
    expect(licenceFaults(security, { packages: { "": {}, "node_modules/x": { license: "GPL-3.0-only" } } })).toEqual(["GPL-3.0-only is in the tree but not allowed"]);
    expect(licenceFaults(security.replace("allow-licenses:", "deny-licenses:"), lock)).toEqual(["dependency review uses the deprecated deny-licenses"]);
  });
});

describe("the runtime image", () => {
  const dockerfile = readFileSync(join(REPO, "Dockerfile"), "utf8");
  it("removes the base image's npm", () => {
    expect(runtimeFaults(dockerfile)).toEqual([]);
  });
  it("a planted removal goes red", () => {
    expect(runtimeFaults(dockerfile.replace(/ && rm -rf \/usr\/local\/lib\/node_modules\/npm[^\n]*\n/, ""))).toEqual(["the runtime stage still ships npm"]);
  });
});

describe("actionlint in the Lint job", () => {
  const ci = readFileSync(join(WF, "ci.yml"), "utf8");
  it("runs, pinned by digest", () => {
    expect(actionlintFaults(ci)).toEqual([]);
  });
  it("a planted removal, or a tag instead of the digest, goes red", () => {
    expect(actionlintFaults(ci.replace(/ {6}- name: actionlint\n[^\n]*\n/, ""))).toEqual(["the Lint job does not run actionlint pinned by digest"]);
    expect(actionlintFaults(ci.replace(/rhysd\/actionlint@sha256:[0-9a-f]{64}/, "rhysd/actionlint:1.7.7"))).toEqual(["the Lint job does not run actionlint pinned by digest"]);
  });
});

describe("the triggers SECURITY.md names", () => {
  const security = readFileSync(join(REPO, "SECURITY.md"), "utf8");
  const wf = (n: string): string => readFileSync(join(WF, n), "utf8");
  it("match the workflows", () => {
    expect(triggerFaults(security, wf)).toEqual([]);
  });
  it("a schedule added to ci.yml, or a dependency review on every push, goes red", () => {
    const withSchedule = (n: string): string => (n === "ci.yml" ? wf(n).replace("\n  workflow_dispatch:\n", "\n  schedule:\n    - cron: \"0 3 * * 1\"\n  workflow_dispatch:\n") : wf(n));
    expect(triggerFaults(security, withSchedule)).toEqual(["SECURITY.md and ci.yml disagree about a CI schedule"]);
    const everyPush = (n: string): string => (n === "security.yml" ? wf(n).replace("\n    if: github.event_name == 'pull_request'\n", "\n") : wf(n));
    expect(triggerFaults(security, everyPush)).toEqual(["dependency review is no longer pull-request only"]);
  });
});

describe("the checks the README names", () => {
  const read = (n: string): string => readFileSync(join(WF, n), "utf8");
  const readme = readFileSync(join(REPO, "README.md"), "utf8");
  const expected = [
    ...jobNames(read("ci.yml")).map((j) => `CI | ${j}`),
    ...jobNames(read("security.yml")).map((j) => `Security | ${j}`),
    ...jobNames(read("scorecard.yml")).map((j) => `Scorecard | ${j}`),
    ...jobNames(read("snyk.yml")).map((j) => `Snyk | ${j}`),
    "Release | Release gate",
    "Release | Mutation check",
    "Release | Snyk (dependencies)",
  ];

  it("the job names are pinned, so a renamed job is red here and in the README", () => {
    expect(expected).toEqual([
      "CI | Lint",
      "CI | Unit tests",
      "CI | Migration lint",
      "CI | Integration tests (PostGIS)",
      "CI | Image (build, scan, healthz)",
      "Security | CodeQL (TypeScript)",
      "Security | Dependency review",
      "Security | Secrets in history (gitleaks)",
      "Security | DAST (OWASP ZAP against the container)",
      "Scorecard | Scorecard analysis",
      "Snyk | Snyk (dependencies)",
      "Release | Release gate",
      "Release | Mutation check",
      "Release | Snyk (dependencies)",
    ]);
    expect(jobNames(release).slice(0, 3)).toEqual(["Release gate", "Mutation check", "Snyk (dependencies)"]);
  });

  it("the README's Checks table lists exactly those jobs, in that order", () => {
    expect(readmeChecks(readme)).toEqual(expected);
  });

  it("a renamed job makes the README stale (the comparison can say no)", () => {
    const renamed = read("ci.yml").replace("    name: Unit tests\n", "    name: Unit\n");
    expect(jobNames(renamed)).toContain("Unit");
    expect(readmeChecks(readme).slice(0, 5)).not.toEqual(jobNames(renamed).map((j) => `CI | ${j}`));
  });

  it("the README names the coverage thresholds the config enforces", () => {
    const config = readFileSync(join(REPO, "vitest.coverage.config.ts"), "utf8");
    for (const k of ["lines", "branches", "functions", "statements"]) {
      const v = THRESHOLD(k).exec(config.slice(config.indexOf("thresholds:")))?.[1];
      expect(readme, k).toContain(`${k} ${v ?? "?"}`);
    }
  });

  it("the coverage badge shows the lines threshold, and the last measurement when one is on disk", () => {
    const config = readFileSync(join(REPO, "vitest.coverage.config.ts"), "utf8");
    const lines = THRESHOLD("lines").exec(config.slice(config.indexOf("thresholds:")))?.[1];
    expect(badgeLines(readme)).toBe(Number(lines));
    const summary = join(REPO, "coverage", "coverage-summary.json");
    // CI checks the fresh measurement after the run (the step "Coverage badge matches the measurement").
    if (existsSync(summary)) expect(badgeFault(readme, readTotals(readFileSync(summary, "utf8")))).toBeNull();
  });
});

describe("the coverage gate", () => {
  const ci = readFileSync(join(WF, "ci.yml"), "utf8");
  const config = readFileSync(join(REPO, "vitest.coverage.config.ts"), "utf8");

  it("CI runs coverage in the Integration tests (PostGIS) job, writes the summary and uploads the report", () => {
    expect(coverageFaults(ci)).toEqual([]);
  });

  it("the four thresholds are set and above zero", () => {
    expect(thresholdFaults(config)).toEqual([]);
  });

  it("the package runs both layers through the coverage config", () => {
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { scripts: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.scripts["coverage"]).toBe("vitest run --config vitest.coverage.config.ts --coverage");
    expect(pkg.devDependencies["@vitest/coverage-v8"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(config).toContain('{ extends: "./vitest.config.ts", test: { name: "unit" } }');
    expect(config).toContain('{ extends: "./vitest.db.config.ts", test: { name: "db" } }');
    expect(config).toContain('reporter: ["text-summary", "lcov", "json-summary"]');
  });

  it("a planted removal goes red", () => {
    expect(coverageFaults(ci.replace("        run: npm run coverage\n", "        run: npm run test:db\n"))).toEqual([
      "the integration job does not run npm run coverage",
      "the integration job still runs plain test:db",
    ]);
    expect(coverageFaults(ci.replace(/ {6}- name: Upload the coverage report\n[^]*?retention-days: 14\n/, ""))).toEqual(["the coverage directory is not uploaded"]);
    expect(coverageFaults(ci.replace("          POSTGRES_PASSWORD: ci\n", "          POSTGRES_PASSWORD: ci\n          POSTGRES_DB: viafrei_empty\n").replace(/ {6}- name: An empty database\n[^]*?create database viafrei_empty'\n/, ""))).toEqual([
      "the integration database is the image's POSTGRES_DB, not a plain create database",
      "the integration job does not make its database with a plain create database",
    ]);
    expect(coverageFaults(ci.replace(/ {6}- name: Coverage summary\n[^]*?GITHUB_STEP_SUMMARY"\n/, ""))).toEqual(["no coverage summary in the job summary"]);
    expect(thresholdFaults(config.replace(/\n\s+branches: [\d.]+,\n/, "\n"))).toEqual(["branches: no threshold"]);
    expect(thresholdFaults(config.replace(/(\n\s+lines: )[\d.]+,/, "$10,"))).toEqual(["lines: threshold 0 is not above zero"]);
    expect(thresholdFaults(config.replace("thresholds:", "limits:"))).toHaveLength(4);
    expect(coverageFaults(ci.replace(/ {6}- name: Coverage badge matches the measurement\n[^]*?coverage-summary\.json\n/, ""))).toEqual(["the coverage badge is not compared with the measurement"]);
  });

  it("every coverage ignore in src carries its reason on the line above", () => {
    const missing: string[] = [];
    let n = 0;
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".ts")) {
          const lines = readFileSync(p, "utf8").split("\n");
          lines.forEach((l, i) => {
            if (!/v8 ignore|c8 ignore|istanbul ignore/.test(l)) return;
            n += 1;
            if (!/^\s*\/\/ \S.{20,}/.test(lines[i - 1] ?? "")) missing.push(`${p.slice(REPO.length + 1)}:${String(i + 1)}`);
          });
        }
      }
    };
    walk(join(REPO, "src"));
    expect(missing).toEqual([]);
    expect(n).toBe(3);
  });
});

/** Every image pinned by digest in the sources, by name. */
export function pinnedImages(sources: readonly string[]): Set<string> {
  const images = new Set<string>();
  for (const text of sources) {
    for (const line of text.split("\n")) {
      if (/^\s*(?:-\s+)?uses:/.test(line)) continue;
      // Any reference pinned by digest, with or without a namespace and a tag:
      // `org/tool:1.0@sha256:…`, `alpine@sha256:…`, `node:22@sha256:…`, and the
      // default of `${VAR:-image@sha256:…}`; never inside a `$name` or `oci://`.
      for (const m of line.matchAll(/(?:(?<![\w./:@${-])|(?<=:-))((?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*)(?::[\w.-]+)?@sha256:[0-9a-f]{64}/g)) images.add(m[1] ?? "");
    }
  }
  return images;
}

/** The images listed in SECURITY.md's hand-bumped table. */
export function listedImages(security: string): Set<string> {
  return new Set([...security.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1] ?? ""));
}

/**
 * Dependabot's TypeScript bound must be typescript-eslint's: the `versions`
 * ignore for typescript is ">=<upper bound>" of the peer range every
 * typescript-eslint package in the lock declares for typescript.
 */
export function typescriptBoundFaults(dependabot: string, lock: string): string[] {
  const m = /- dependency-name: typescript\n\s+versions: \[">=([0-9.]+)"\]/.exec(dependabot);
  if (m === null) return ['.github/dependabot.yml has no `versions: [">=X.Y.Z"]` ignore for typescript'];
  const bound = m[1];
  const packages = (JSON.parse(lock) as { packages: Record<string, { version?: string; peerDependencies?: Record<string, string> }> }).packages;
  const faults: string[] = [];
  let seen = 0;
  for (const [path, p] of Object.entries(packages)) {
    if (!/^node_modules\/(?:typescript-eslint|@typescript-eslint\/[^/]+)$/.test(path)) continue;
    const range = p.peerDependencies?.["typescript"];
    if (range === undefined) continue;
    seen++;
    const upper = /<([0-9.]+)\s*$/.exec(range)?.[1];
    if (upper !== bound) faults.push(`${path} accepts typescript "${range}", but dependabot.yml ignores ">=${bound ?? ""}"`);
  }
  if (seen === 0) faults.push("no typescript-eslint package in package-lock.json declares a typescript peer range");
  return faults;
}

describe("the TypeScript bound in dependabot.yml", () => {
  const dependabot = readFileSync(join(REPO, ".github", "dependabot.yml"), "utf8");
  const lock = readFileSync(join(REPO, "package-lock.json"), "utf8");
  it("is the upper bound of typescript-eslint's peer range in the lock", () => {
    expect(typescriptBoundFaults(dependabot, lock)).toEqual([]);
  });
  it("goes red when typescript-eslint widens its range and the bound stays", () => {
    const wider = lock.replaceAll('"typescript": ">=4.8.4 <6.1.0"', '"typescript": ">=4.8.4 <7.1.0"');
    expect(wider).not.toBe(lock);
    expect(typescriptBoundFaults(dependabot, wider)).toContain('node_modules/typescript-eslint accepts typescript ">=4.8.4 <7.1.0", but dependabot.yml ignores ">=6.1.0"');
  });
  it("goes red when the bound moves alone, or the ignore is gone", () => {
    expect(typescriptBoundFaults(dependabot.replace('[">=6.1.0"]', '[">=7.0.0"]'), lock)).toContain(
      'node_modules/typescript-eslint accepts typescript ">=4.8.4 <6.1.0", but dependabot.yml ignores ">=7.0.0"',
    );
    expect(typescriptBoundFaults(dependabot.replace(/versions: \[[^\]]*\]/, 'update-types: ["version-update:semver-major"]'), lock)).toEqual([
      '.github/dependabot.yml has no `versions: [">=X.Y.Z"]` ignore for typescript',
    ]);
  });
  it("goes red when the lock carries no typescript-eslint peer range at all", () => {
    expect(typescriptBoundFaults(dependabot, JSON.stringify({ packages: {} }))).toEqual(["no typescript-eslint package in package-lock.json declares a typescript peer range"]);
  });
});

/** Every image pinned by digest in a workflow's run:/service lines or a script, against SECURITY.md's hand-bumped list. */
export function pinnedImageFaults(security: string, sources: readonly string[]): string[] {
  const images = pinnedImages(sources);
  const listed = listedImages(security);
  return [...images].filter((i) => !listed.has(i)).sort().map((i) => `${i} is pinned by hand but not listed in SECURITY.md`);
}

describe("the images bumped by hand", () => {
  const security = readFileSync(join(REPO, "SECURITY.md"), "utf8");
  const sources = [
    ...["ci.yml", "security.yml", "release.yml", "scorecard.yml"].map((n) => readFileSync(join(WF, n), "utf8")),
    // The tracked scripts only: a local, untracked helper is not part of this repository.
    ...execFileSync("git", ["ls-files", "scripts/*.sh"], { cwd: REPO, encoding: "utf8" }).split("\n").filter((n) => n !== "").map((n) => readFileSync(join(REPO, n), "utf8")),
  ];
  it("are all listed in SECURITY.md, and the list is exactly what the scan sees (six of them)", () => {
    expect(pinnedImageFaults(security, sources)).toEqual([]);
    const scanned = [...pinnedImages(sources)].sort();
    expect(scanned).toEqual([...listedImages(security)].sort());
    expect(scanned).toHaveLength(6);
  });
  it("an image added to a script but not to the list goes red", () => {
    expect(pinnedImageFaults(security, [...sources, `docker run example/tool:1.0@sha256:${"a".repeat(64)}`])).toEqual(["example/tool is pinned by hand but not listed in SECURITY.md"]);
  });
  it.each([
    ["an official image without a namespace", "alpine@sha256:", "alpine"],
    ["an official image with a tag and no namespace", "node:22@sha256:", "node"],
    ["an image from another registry", "image: ghcr.io/example/tool:2@sha256:", "ghcr.io/example/tool"],
    ["the default of a shell parameter", 'X="${Y:-example/tool:1@sha256:', "example/tool"],
  ])("%s, pinned and unlisted, goes red", (_n, ref, name) => {
    expect(pinnedImageFaults(security, [...sources, `FROM ${ref}${"b".repeat(64)}`])).toEqual([`${name} is pinned by hand but not listed in SECURITY.md`]);
  });
  it("does not read a digest without an image name, or a uses: line, as an image", () => {
    const d = `@sha256:${"c".repeat(64)}`;
    expect(pinnedImageFaults(security, [...sources, `IMAGE="$name${d}"`, `oci://$IMAGE${d}`, `      - uses: actions/checkout${d}`])).toEqual([]);
  });
});

// Owner 2026-11-15: Snyk runs once a week on main and once per release, before
// anything is published, and never on a pull request or a push.

/** snyk.yml's whole trigger block: the dispatch takes no input and is followed directly by the call. */
export const SNYK_TRIGGERS = '\non:\n  schedule:\n    - cron: "17 5 * * 1" # Mondays 05:17 UTC\n  workflow_dispatch:\n  workflow_call:\n    inputs:\n      ref:\n';
/** The scan step whole (name, env and run, nothing between) and the upload's head after it: no `|| true`, no lower threshold, the SARIF uploaded only for the run's own commit. */
export const SNYK_SCAN =
  "\n      - name: Snyk test\n        env:\n          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}\n        run: |\n          mkdir -p sarif\n          ./snyk test --severity-threshold=high --sarif-file-output=sarif/snyk.sarif\n" +
  "      - name: Upload SARIF to code scanning\n        # A called run scans another commit than the caller's github.sha; its findings are\n        # uploaded only when they belong to the commit code scanning files them under.\n" +
  "        if: always() && hashFiles('sarif/snyk.sarif') != '' && (inputs.ref == '' || inputs.ref == github.sha)\n";
/** The scan checks out the commit it was handed, or the run's own. */
export const SNYK_CHECKOUT = "\n        with:\n          ref: ${{ inputs.ref || github.sha }}\n          persist-credentials: false\n";
const SNYK_SECRETS = "\n    secrets:\n      SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}\n";

/** The guard step's run block, dedented, as the runner hands it to bash. */
export function snykGuard(snyk: string): string {
  const m = /\n {6}- name: The run scans main or a release's commit\n(?: {8}.*\n)*? {8}run: \|\n((?: {10}.*\n)+)/.exec(snyk);
  return (m?.[1] ?? "").replace(/^ {10}/gm, "");
}

/** The guard's exit status for one REF_IN on one GITHUB_REF, run as the runner does. */
export function runSnykGuard(script: string, ref: string, gitRef: string): number {
  try {
    execFileSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], { env: { PATH: process.env.PATH ?? "", REF_IN: ref, GITHUB_REF: gitRef }, stdio: "ignore" });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
}

const SHA40 = "0123456789abcdef0123456789abcdef01234567";
/** What the guard must answer: a wrong ref is exit 2, never a skip (a skipped job is a green run about nothing). */
export const SNYK_GUARD_CASES: [string, string, number][] = [
  ["", "refs/heads/feature", 2],
  ["", "refs/pull/1/merge", 2],
  ["", "refs/heads/main", 0],
  [SHA40, "refs/heads/feature", 0],
  ["v1.2.3", "refs/heads/main", 2],
  [SHA40.toUpperCase(), "refs/heads/main", 2],
  [SHA40.slice(1), "refs/heads/main", 2],
];

export function snykFaults(files: Record<string, string>): string[] {
  const faults: string[] = [];
  const sn = files["snyk.yml"] ?? "";
  const on = /\non:\n([^]*?)\n(?=[a-z])/.exec(sn)?.[1] ?? "";
  const triggers = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
  if (triggers.join() !== "schedule,workflow_dispatch,workflow_call") faults.push(`snyk.yml runs on ${triggers.join(", ")}, not the weekly schedule, a dispatch and the release call alone`);
  if (!sn.includes(SNYK_TRIGGERS)) faults.push("snyk.yml's trigger block is not the weekly schedule, a dispatch with no input and the release call");
  if (!sn.includes(SNYK_SCAN)) faults.push("snyk.yml's scan step and SARIF upload are not exactly the high-threshold scan and the own-commit upload");
  if (!sn.includes(SNYK_CHECKOUT)) faults.push("snyk.yml does not check out ${{ inputs.ref || github.sha }}");
  if (sn.includes("continue-on-error")) faults.push("snyk.yml carries continue-on-error");
  const guard = snykGuard(sn);
  if (guard === "") faults.push("snyk.yml has no guard step");
  else
    for (const [ref, gitRef, want] of SNYK_GUARD_CASES) {
      const got = runSnykGuard(guard, ref, gitRef);
      if (got !== want) faults.push(`the guard exits ${String(got)} for REF_IN="${ref}" on ${gitRef}, not ${String(want)}`);
    }
  for (const [n, t] of Object.entries(files)) {
    if (n !== "snyk.yml" && t.includes("snyk test")) faults.push(`${n} runs the Snyk CLI; only snyk.yml does`);
    if (n !== "release.yml" && t.includes("workflows/snyk.yml")) faults.push(`${n} references workflows/snyk.yml; only release.yml calls it`);
    if (t.includes("secrets: inherit")) faults.push(`${n} passes secrets: inherit`);
  }
  const rel = files["release.yml"] ?? "";
  const s = /\n {2}snyk:\n/.test(rel.slice(rel.indexOf("\njobs:\n"))) ? job(rel, "snyk") : "";
  if (!s.includes("\n    needs: gate\n    if: needs.gate.outputs.publish == 'true'\n") || !s.includes("\n    uses: ./.github/workflows/snyk.yml\n    with:\n      ref: ${{ needs.gate.outputs.commit }}\n")) faults.push("release.yml's snyk job does not call snyk.yml on the gate's commit");
  if (!s.endsWith(`${SNYK_SECRETS}\n`) && !s.endsWith(SNYK_SECRETS)) faults.push("release.yml's snyk job does not pass exactly SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}");
  if (!/\n {4}needs: \[gate, mutants, snyk\]\n/.test(job(rel, "publish"))) faults.push("release.yml's publish does not need snyk");
  return faults;
}

describe("Snyk: weekly on main and once per release, never on a pull request or a push", () => {
  const files: Record<string, string> = Object.fromEntries(workflows.map((n) => [n, readFileSync(join(WF, n), "utf8")]));
  const plant = (n: string, from: string, to: string): Record<string, string> => {
    const t = files[n] ?? "";
    expect(t.includes(from), `${n}: ${from}`).toBe(true);
    return { ...files, [n]: t.replace(from, to) };
  };

  it("the workflows hold the rule", () => {
    expect(snykFaults(files)).toEqual([]);
    // Snyk is the one schedule this rule adds; ci.yml keeps none (triggerFaults)
    expect(readFileSync(join(REPO, "SECURITY.md"), "utf8")).toContain("| Snyk over the dependencies | Snyk | weekly on `main`, and every release before the image is published |");
  });

  it("each planted fault goes red", () => {
    const cases: [string, Record<string, string>][] = [
      ['the guard exits 0 for REF_IN="" on refs/heads/feature', plant("snyk.yml", 'not on $GITHUB_REF"; exit 2', 'not on $GITHUB_REF"; exit 0')],
      ['the guard exits 2 for REF_IN="" on refs/heads/main', plant("snyk.yml", "if [[ -n $REF_IN ]]; then", "if [[ -n x ]]; then")],
      ['the guard exits 0 for REF_IN="v1.2.3"', plant("snyk.yml", "            [[ $REF_IN =~ ^[0-9a-f]{40}$ ]] || {", "            true || {")],
      ["a dispatch with no input", plant("snyk.yml", "  workflow_dispatch:\n", "  workflow_dispatch:\n    inputs:\n      ref:\n        type: string\n")],
      ["the weekly schedule, a dispatch and the release call alone", plant("snyk.yml", "  workflow_dispatch:\n", "  pull_request:\n  workflow_dispatch:\n")],
      ["the weekly schedule, a dispatch and the release call alone", plant("snyk.yml", "  workflow_dispatch:\n", "  push:\n    branches: [main]\n  workflow_dispatch:\n")],
      ["the high-threshold scan", plant("snyk.yml", "--sarif-file-output=sarif/snyk.sarif\n", "--sarif-file-output=sarif/snyk.sarif || true\n")],
      ["the high-threshold scan", plant("snyk.yml", "          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}\n        run: |\n          mkdir", "          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}\n        continue-on-error: true\n        run: |\n          mkdir")],
      ["the own-commit upload", plant("snyk.yml", " && (inputs.ref == '' || inputs.ref == github.sha)", "")],
      ["snyk.yml does not check out", plant("snyk.yml", "ref: ${{ inputs.ref || github.sha }}", "ref: ${{ github.sha }}")],
      ["snyk.yml carries continue-on-error", plant("snyk.yml", "    timeout-minutes: 10\n", "    timeout-minutes: 10\n    continue-on-error: true\n")],
      ["ci.yml references workflows/snyk.yml", plant("ci.yml", "\njobs:\n", "\njobs:\n  s:\n    uses: ./.github/workflows/snyk.yml\n")],
      ["release.yml passes secrets: inherit", plant("release.yml", SNYK_SECRETS, "\n    secrets: inherit\n")],
      ["release.yml's publish does not need snyk", plant("release.yml", "    needs: [gate, mutants, snyk]\n", "    needs: [gate, mutants]\n")],
      ["security.yml runs the Snyk CLI", plant("security.yml", "\njobs:\n", "\njobs:\n  x:\n    steps:\n      - run: ./snyk test\n")],
    ];
    for (const [want, f] of cases) expect(snykFaults(f).join("; "), want).toContain(want);
  });
});
