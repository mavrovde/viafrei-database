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

  it("runs on a tag push and nothing else", () => {
    expect(/\non:\n {2}push:\n {4}tags: \["v\*"\]\n\n/.test(release)).toBe(true);
    expect(release).not.toMatch(/branches:|pull_request|workflow_dispatch|schedule:|workflow_run/);
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
    expect(job(release, "publish")).toContain("\n    needs: gate\n    if: needs.gate.outputs.publish == 'true'\n");
    expect(job(release, "verify")).toContain("\n    needs: [gate, publish]\n");
    expect(job(release, "tag")).toContain("\n    needs: [gate, publish, verify]\n");
  });

  it("verifies the attestation and smokes the digest in the verify job, which the tag job waits for", () => {
    expect(verifyFaults(release)).toEqual([]);
  });

  it("a planted removal of the attestation check, the smoke or the wait goes red", () => {
    expect(verifyFaults(release.replace(/ {6}- name: gh attestation verify\n[^]*?--source-ref "refs\/tags\/\$TAG"\n/, ""))).toEqual(["verify does not run gh attestation verify on the digest"]);
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
    // The workflow's last job is the tag job.
    expect(release.slice(release.indexOf("\n  tag:\n") + 1)).toBe(job(release, "tag"));
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
    expect(sec).toContain("Only repository administrators may create, update or\n  delete a `v*` tag");
    expect(sec).toContain("scripts/ghcr-not-released.sh");
  });
});

describe("permissions", () => {
  it("are read-only for the workflow and every job but publish and tag", () => {
    expect(release).toMatch(/\npermissions:\n {2}contents: read\n\n/);
    expect(permissions(job(release, "gate"))).toEqual(["contents: read", "actions: read"]);
    expect(permissions(job(release, "publish"))).toEqual(["contents: read", "packages: write", "id-token: write", "attestations: write"]);
    expect(permissions(job(release, "verify"))).toEqual(["contents: read", "packages: read", "attestations: read"]);
    expect(permissions(job(release, "tag"))).toEqual(["contents: read", "packages: write"]);
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
        expect(m[1], `${n}: ${m[1] ?? ""}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      }
    }
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

/**
 * What the verify job must do to the pushed digest before the tag job may
 * point a tag at it: the provenance attestation checked and the image smoked.
 */
export function verifyFaults(release: string): string[] {
  const faults: string[] = [];
  const v = job(release, "verify");
  if (!v.includes('\n        run: gh attestation verify "oci://$IMAGE@$DIGEST" --repo "$GH_REPO" --signer-workflow mavrovde/viafrei-database/.github/workflows/release.yml --source-ref "refs/tags/$TAG"\n')) faults.push("verify does not run gh attestation verify on the digest");
  if (!v.includes('\n        run: cosign verify-attestation "$IMAGE@$DIGEST" --type spdxjson --certificate-identity-regexp "$IDENTITY" --certificate-oidc-issuer "$ISSUER" --certificate-github-workflow-sha "$COMMIT" > /dev/null\n')) faults.push("verify does not check the SBOM attestation");
  if (!v.includes("\n          IMAGE_REF: ${{ env.IMAGE }}@${{ needs.publish.outputs.digest }}\n        run: IMAGE=\"$IMAGE_REF\" scripts/image-smoke.sh\n")) faults.push("verify does not smoke the published digest");
  if (!job(release, "tag").includes("\n    needs: [gate, publish, verify]\n")) faults.push("the tag job does not wait for verify");
  return faults;
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
  for (const id of ["publish", "verify", "tag"]) {
    const j = job(release, id);
    if (!j.includes("\n        with:\n          ref: ${{ needs.gate.outputs.commit }}\n")) faults.push(`${id} does not check out the gate's commit`);
    if (j.includes("ref: refs/tags/")) faults.push(`${id} checks out the tag ref`);
  }
  if (!job(release, "gate").includes('[[ $commit == "$GITHUB_SHA" ]] || {')) faults.push("the gate does not refuse a tag that has moved off github.sha");
  if (!release.includes("\nconcurrency:\n  group: release\n  cancel-in-progress: false\n")) faults.push("releases are not serialised in one group");
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
  if (!sc.includes("schedule:") || !/push:\n\s+branches: \[main\]/.test(sc) || sc.includes("pull_request:")) faults.push("scorecard.yml no longer runs on pushes to main and weekly only");
  if (!job(wf("security.yml"), "dependency-review").includes("\n    if: github.event_name == 'pull_request'\n")) faults.push("dependency review is no longer pull-request only");
  if (!security.includes("| dependency review | Security | pull requests only")) faults.push("SECURITY.md does not say dependency review runs on pull requests only");
  if (!security.includes("| OpenSSF Scorecard | Scorecard | every push to `main`, weekly")) faults.push("SECURITY.md does not say when Scorecard runs");
  return faults;
}

describe("the release's checkouts and concurrency", () => {
  const release = readFileSync(join(WF, "release.yml"), "utf8");
  it("publish, verify and tag build from the gate's commit; the gate pins the tag to github.sha", () => {
    expect(checkoutFaults(release)).toEqual([]);
  });
  it("a checkout of the tag ref, a missing sha check or a per-tag group goes red", () => {
    const tagRef = release.replace("          ref: ${{ needs.gate.outputs.commit }}\n          persist-credentials: false\n", "          ref: refs/tags/${{ env.TAG }}\n          persist-credentials: false\n");
    expect(checkoutFaults(tagRef)).toEqual(["publish does not check out the gate's commit", "publish checks out the tag ref"]);
    expect(checkoutFaults(release.replace(/ {10}\[\[ \$commit == "\$GITHUB_SHA" \]\][^\n]*\n/, ""))).toEqual(["the gate does not refuse a tag that has moved off github.sha"]);
    expect(checkoutFaults(release.replace("  group: release\n", "  group: release-${{ github.ref_name }}\n"))).toEqual(["releases are not serialised in one group"]);
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
    "Release | Release gate",
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
      "Release | Release gate",
    ]);
    expect(jobNames(release)).toContain("Release gate");
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
