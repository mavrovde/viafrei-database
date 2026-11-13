/**
 * scripts/ghcr-not-released.sh behind stubs for docker and gh: the registry's
 * answers it must take as "not released" and every one it must refuse.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";

const dir = mkdtempSync(join(tmpdir(), "vf-ghcr-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
// Each stub answers from an env variable: <exit code>:<text>.
const stub = (name: string, v: string): string => {
  const p = join(dir, name);
  writeFileSync(p, `#!/usr/bin/env bash\nans="\${${v}:-}"\nif [[ $* == *" users/"*"/packages/container/"* || $* == *" orgs/"*"/packages/container/"* ]]; then ans="\${${v}_PKG:-}"; fi\nprintf '%s\\n' "\${ans#*:}"\nexit "\${ans%%:*}"\n`);
  chmodSync(p, 0o755);
  return p;
};
const DOCKER = stub("docker", "STUB_DOCKER");
const GH = stub("gh", "STUB_GH");

const run = (docker: string, gh = "1:unused", pkg = "1:unused", args = ["ghcr.io/mavrovde/viafrei-database", "1.2.3"]): { code: number; out: string } => {
  const r = spawnSync("bash", [join(REPO, "scripts", "ghcr-not-released.sh"), ...args], {
    env: { PATH: process.env["PATH"] ?? "", DOCKER, GH, STUB_DOCKER: docker, STUB_GH: gh, STUB_GH_PKG: pkg },
    encoding: "utf8",
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
};

describe("ghcr-not-released.sh", () => {
  it("refuses a version that exists", () => {
    expect(run("0:Name: ghcr.io/…")).toMatchObject({ code: 1, out: expect.stringContaining("already exists") as unknown });
  });
  it("passes 'not found' and 'manifest unknown'", () => {
    expect(run("1:ERROR: ghcr.io/mavrovde/viafrei-database:1.2.3: not found").code).toBe(0);
    expect(run("1:MANIFEST_UNKNOWN: manifest unknown").code).toBe(0);
  });
  it("passes 'denied' when the package itself does not exist (the first release)", () => {
    const r = run("1:ERROR: denied: denied", "0:User", "1:gh: Not Found (HTTP 404)");
    expect(r).toMatchObject({ code: 0, out: expect.stringContaining("the first release") as unknown });
  });
  it("looks the package up under an organization when the owner is one", () => {
    expect(run("1:denied", "0:Organization", "1:gh: Not Found (HTTP 404)").code).toBe(0);
  });
  it.each([
    ["denied, and the package exists", "1:denied", "0:User", "0:viafrei-database", "the package viafrei-database exists"],
    ["denied, and the API answers 403", "1:unauthorized: authentication required", "0:User", "1:gh: Forbidden (HTTP 403)", "answered 403"],
    ["denied, and the package is not linked to this repository (403)", "1:ERROR: denied: denied", "0:User", "1:gh: Resource not accessible by integration (HTTP 403)", "not linked to this repository"],
    ["denied, and an organization's API answers 403", "1:denied", "0:Organization", "1:gh: Forbidden (HTTP 403)", "lacks packages: read"],
    ["denied, and the API answers 401", "1:denied", "0:User", "1:gh: Bad credentials (HTTP 401)", "did not answer 404"],
    ["denied, and the API answers 500", "1:denied", "0:User", "1:gh: Server Error (HTTP 500)", "did not answer 404"],
    ["denied, and the owner cannot be read", "1:denied", "1:boom", "1:unused", "cannot be read"],
    ["denied, and the owner is neither", "1:denied", "0:Bot", "1:unused", "neither a user nor an organization"],
    ["any other error", "1:dial tcp: i/o timeout", "1:unused", "1:unused", "cannot tell"],
  ])("refuses %s", (_n, docker, gh, pkg, msg) => {
    const r = run(docker, gh, pkg);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain(msg);
  });
  it.each([
    [["docker.io/x/y", "1.2.3"]],
    [["ghcr.io/mavrovde/viafrei-database", "1.2.3-rc.1"]],
    [[]],
  ])("refuses usage %j with exit 2", (args) => {
    expect(run("1:not found", "1:unused", "1:unused", args).code).toBe(2);
  });
});
