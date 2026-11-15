/**
 * src/fixtures.ts and the `test-fixtures` verb, in process and without a
 * database: the refusals, the install through an injected psql (success, a
 * psql failure, an unreadable file), and the verb through main() with a stub
 * psql on PATH. fixtures.db.test.ts runs the same install against a real
 * test database, as a child process, which coverage does not count.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { databaseOf, FIXTURES_FILE, fixturesRefusal, installFixtures } from "../src/fixtures.js";
import type { PsqlResult, PsqlRunner } from "../src/psql.js";
import { cleanup, stubPsqlBin } from "./helpers.js";

const URL_OK = "postgresql://u@127.0.0.1/test_x";
const ENV = { VF_TEST_FIXTURES: "1", DATABASE_URL: URL_OK };

function stubRun(answer: PsqlResult): { run: PsqlRunner; calls: { script: string; args: readonly string[] }[] } {
  const calls: { script: string; args: readonly string[] }[] = [];
  const run: PsqlRunner = (script, args = []) => {
    calls.push({ script: script.toString(), args });
    return Promise.resolve(answer);
  };
  return { run, calls };
}

describe("databaseOf", () => {
  it("names the database of a URL, or null", () => {
    expect(databaseOf("postgresql://u@h/test_%61")).toBe("test_a");
    expect(databaseOf("postgresql://u@h/")).toBeNull();
    expect(databaseOf("not a url")).toBeNull();
  });
});

describe("fixturesRefusal", () => {
  it.each([
    [{}, "needs VF_TEST_FIXTURES=1"],
    [{ VF_TEST_FIXTURES: "1" }, "needs DATABASE_URL"],
    [{ VF_TEST_FIXTURES: "1", DATABASE_URL: "" }, "needs DATABASE_URL"],
    [{ VF_TEST_FIXTURES: "1", DATABASE_URL: "postgresql://u@h/viafrei" }, "refuses the database 'viafrei'"],
    [{ VF_TEST_FIXTURES: "1", DATABASE_URL: "not a url" }, "refuses the database '(none)'"],
  ])("refuses %j", (env, why) => {
    expect(fixturesRefusal(env)).toContain(why);
  });

  it("lets a test_ database with the variable through", () => {
    expect(fixturesRefusal(ENV)).toBeNull();
  });
});

describe("installFixtures", () => {
  it("runs the file in one transaction from stdin and counts its 12 functions", async () => {
    const s = stubRun({ code: 0, stdout: "", stderr: "" });
    const r = await installFixtures(ENV, s.run, FIXTURES_FILE);
    expect(r).toEqual({ exitCode: 0, lines: ["✓ test fixtures: 12 vf_test function(s) installed (test database test_x)"] });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]?.args).toEqual(["-1", "-f", "-"]);
    expect(s.calls[0]?.script).toContain("CREATE OR REPLACE FUNCTION vf_test");
  });

  it("reports psql's exit code and the first line of its stderr", async () => {
    const r = await installFixtures(ENV, stubRun({ code: 1, stdout: "", stderr: "\n  \nERROR:  vf_test fixtures are for a test_ database only\nCONTEXT: x\n" }).run, FIXTURES_FILE);
    expect(r).toEqual({ exitCode: 1, lines: ["✗ test fixtures could not be installed (psql exit 1): ERROR:  vf_test fixtures are for a test_ database only"] });
  });

  it("says so when psql failed with nothing on stderr", async () => {
    const r = await installFixtures(ENV, stubRun({ code: 3, stdout: "", stderr: "" }).run, FIXTURES_FILE);
    expect(r.lines).toEqual(["✗ test fixtures could not be installed (psql exit 3): (no message)"]);
  });

  it("cuts a long first stderr line at 300 characters", async () => {
    const r = await installFixtures(ENV, stubRun({ code: 1, stdout: "", stderr: "x".repeat(400) }).run, FIXTURES_FILE);
    expect(r.lines[0]).toBe(`✗ test fixtures could not be installed (psql exit 1): ${"x".repeat(300)}`);
  });

  it("exits 1 for a file it cannot read, and runs no psql", async () => {
    const s = stubRun({ code: 0, stdout: "", stderr: "" });
    const missing = join(tmpdir(), "vf-no-such-dir", "vf_test.sql");
    expect(await installFixtures(ENV, s.run, missing)).toEqual({ exitCode: 1, lines: [`✗ test fixtures: ${missing} could not be read`] });
    expect(s.calls).toEqual([]);
  });

  it("exits 2 on a refusal, and runs no psql", async () => {
    const s = stubRun({ code: 0, stdout: "", stderr: "" });
    expect(await installFixtures({ DATABASE_URL: URL_OK }, s.run)).toEqual({ exitCode: 2, lines: ["✗ test-fixtures install needs VF_TEST_FIXTURES=1: the fixtures lift guards, and are installed only on purpose"] });
    expect(s.calls).toEqual([]);
  });
});

describe("the test-fixtures verb, in process", () => {
  let out: string[];
  let err: string[];
  const saved = { ...process.env };
  let root: string | undefined;

  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((c: string | Uint8Array) => (err.push(String(c)), true));
    delete process.env["VF_TEST_FIXTURES"];
    delete process.env["DATABASE_URL"];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...saved };
    if (root !== undefined) cleanup(root);
    root = undefined;
  });

  it("installs through the psql on PATH and prints the count", async () => {
    root = mkdtempSync(join(tmpdir(), "vf-fixtures-"));
    const { binDir, log } = stubPsqlBin(root);
    process.env["PATH"] = `${binDir}${delimiter}${saved["PATH"] ?? ""}`;
    process.env["VF_TEST_FIXTURES"] = "1";
    process.env["DATABASE_URL"] = "postgresql://u:s3cret@127.0.0.1/test_x";
    expect(await main(["test-fixtures", "install"])).toBe(0);
    expect(out.join("")).toBe("✓ test fixtures: 12 vf_test function(s) installed (test database test_x)\n");
    expect(err.join("")).toBe("");
    expect(readFileSync(join(log, "1.args"), "utf8").split("\n")).toEqual(["postgresql://u@127.0.0.1/test_x", "-v", "ON_ERROR_STOP=1", "-q", "-X", "-1", "-f", "-", ""]);
    expect(readFileSync(join(log, "1.pw"), "utf8")).toBe("s3cret");
  });

  it("refuses without the variable, on stderr, with exit 2", async () => {
    process.env["DATABASE_URL"] = URL_OK;
    expect(await main(["test-fixtures", "install"])).toBe(2);
    expect(out.join("")).toBe("");
    expect(err.join("")).toContain("✗ test-fixtures install needs VF_TEST_FIXTURES=1");
  });

  it.each([[["test-fixtures"]], [["test-fixtures", "drop"]], [["test-fixtures", "install", "now"]]])("is a usage error for %j", async (argv) => {
    expect(await main(argv)).toBe(2);
    expect(err.join("")).toContain("test-fixtures takes one sub-verb: install");
  });
});
