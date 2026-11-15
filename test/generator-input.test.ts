/**
 * test/generator-input.ts: what the hand-run generators accept from the
 * command line and the environment, and the code-unit order they sort by.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { byCodeUnit, REPO_ROOT, repoFile, testDatabase } from "./generator-input.js";

describe("testDatabase", () => {
  it("builds the client configuration of a loopback test_ database from its checked parts", () => {
    expect(testDatabase("postgresql://u:p%40ss@127.0.0.1:5432/test_viafrei")).toEqual({ host: "127.0.0.1", port: 5432, user: "u", password: "p@ss", database: "test_viafrei" });
    expect(testDatabase("postgres://localhost/test_a")).toEqual({ host: "localhost", database: "test_a" });
    expect(testDatabase("postgresql://u@[::1]/test_b")).toEqual({ host: "::1", user: "u", database: "test_b" });
  });

  it("carries no other part of the URL", () => {
    expect(testDatabase("postgresql://u@localhost/test_a?host=elsewhere&sslmode=disable")).toEqual({ host: "localhost", user: "u", database: "test_a" });
  });

  it.each([
    [undefined, "a database URL is required"],
    ["", "a database URL is required"],
    ["not a url", "does not parse"],
    ["mysql://localhost/test_a", "must be postgres://"],
    ["postgresql://db.example.org/test_a", "must be loopback"],
    ["postgresql://10.0.0.1/test_a", "must be loopback"],
    ["postgresql://localhost/viafrei", "must be a test_ database"],
    ["postgresql://localhost/", "must be a test_ database"],
    ["postgresql://localhost/test_", "must be a test_ database"],
    ["postgresql://localhost/test_a%3Bb", "must be a test_ database"],
  ])("refuses %s", (arg, why) => {
    expect(() => testDatabase(arg)).toThrow(why);
  });
});

describe("repoFile", () => {
  it("resolves a path inside the repository, relative or absolute", () => {
    expect(repoFile("test/checks/constraints.tsv")).toBe(join(REPO_ROOT, "test", "checks", "constraints.tsv"));
    expect(repoFile(join(REPO_ROOT, "package.json"))).toBe(join(REPO_ROOT, "package.json"));
    expect(repoFile("a/../..x", "/r")).toBe("/r/..x");
  });

  it.each(["..", "../x", "test/../../x", "/etc/passwd", "", "."])("refuses %j", (p) => {
    expect(() => repoFile(p)).toThrow("is not a file inside the repository");
  });
});

describe("byCodeUnit", () => {
  it("orders as sort() with no compare function does", () => {
    const words = ["b", "B", "a", "_x", "Z", "é", "a=1", "a", "10", "9"];
    expect([...words].sort(byCodeUnit)).toEqual(["10", "9", "B", "Z", "_x", "a", "a", "a=1", "b", "é"]);
  });
});
