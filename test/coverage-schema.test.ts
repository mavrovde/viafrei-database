import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkoutHead, fixtureObjects, judge, KINDS, listTests, listTitles, parseGap, parseManifest, Refusal, report, withFixtures, type Obj } from "../scripts/coverage-schema.js";
import { plantTree, REPO } from "./helpers.js";

const ALL: Obj[] = KINDS.map((kind) => ({ kind, name: `x.${kind}` }));
const TESTS = new Map([["test/a.db.test.ts", new Set(["proves it"])]]);
const row = (kind: string, name: string, test = "test/a.db.test.ts > proves it"): string => `${kind}\t${name}\t${test}`;
const fullManifest = parseManifest(ALL.map((o) => row(o.kind, o.name)).join("\n"));

describe("the schema coverage gate", () => {
  it("passes when every object has a manifest row naming a test that exists", () => {
    const v = judge(ALL, fullManifest, [], TESTS);
    expect(v.ok).toBe(true);
    expect(report(v)).toMatch(/^✓ schema coverage: 10 of 10 catalogue object\(s\) proved, 0 in the gap, 0 missing/m);
  });

  it("fails on an object with no row, a row for no object, a row naming no test, and a test file it cannot list", () => {
    const m = parseManifest([row("table", "x.table"), row("table", "x.gone"), row("view", "x.view", "test/a.db.test.ts > does not exist"), row("view", "x.view", "test/none.db.test.ts > proves it")].join("\n"));
    const v = judge(ALL, [...fullManifest.filter((r) => r.kind !== "view" && r.kind !== "check"), ...m], [], TESTS);
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual([{ kind: "check", name: "x.check" }]);
    expect(v.stale.map((r) => r.name)).toEqual(["x.gone"]);
    expect(v.unknownTests.map((r) => `${r.file} > ${r.title}`)).toEqual(["test/a.db.test.ts > does not exist", "test/none.db.test.ts > proves it"]);
    const text = report(v);
    expect(text).toContain("✗ check x.check: no manifest row and no gap row");
    expect(text).toContain("✗ schema.tsv:2: table x.gone is not in the catalogue");
    expect(text).toContain('✗ schema.tsv:3: no test "does not exist" in test/a.db.test.ts');
    expect(text).toMatch(/^✗ schema coverage: /m);
  });

  it("fails on a row naming a test that does not exist, when nothing else is wrong", () => {
    const v = judge(ALL, [...fullManifest, ...parseManifest(row("table", "x.table", "test/a.db.test.ts > renamed since"))], [], TESTS);
    expect(v.missing.length + v.stale.length + v.staleGap.length + v.coveredGap.length).toBe(0);
    expect(v.ok).toBe(false);
  });

  it("accepts a gap row for an uncovered object, and only shrinks: a covered or vanished gap row fails", () => {
    const less = fullManifest.filter((r) => r.kind !== "role");
    const ok = judge(ALL, less, parseGap("role\tx.role"), TESTS);
    expect(ok.ok).toBe(true);
    expect(ok.perKind.get("role")).toEqual({ objects: 1, covered: 0, gap: 1 });
    const covered = judge(ALL, fullManifest, parseGap("role\tx.role"), TESTS);
    expect(covered.ok).toBe(false);
    expect(report(covered)).toContain("✗ gap.tsv:1: role x.role has a manifest row now — remove the gap row");
    const gone = judge(ALL, less, parseGap("role\tx.role\nrole\tx.gone"), TESTS);
    expect(gone.ok).toBe(false);
    expect(report(gone)).toContain("✗ gap.tsv:2: role x.gone is not in the catalogue — remove the row");
  });

  it("refuses an empty catalogue read, a kind the schema always holds read as none, and an empty manifest", () => {
    expect(() => judge([], fullManifest, [], TESTS)).toThrow(/the catalogue read returned no table/);
    expect(() => judge(ALL.filter((o) => o.kind !== "policy"), fullManifest, [], TESTS)).toThrow(/no policy/);
    expect(() => judge(ALL, parseManifest("# only a comment\n\n"), [], TESTS)).toThrow(/manifest has no row/);
  });

  it("refuses a malformed manifest or gap row rather than skipping it", () => {
    expect(() => parseManifest("table\tx.t")).toThrow(/3 non-empty tab-separated cells/);
    expect(() => parseManifest("table\tx.t\t ")).toThrow(Refusal);
    expect(() => parseManifest("table\t x.t\ttest/a > b")).toThrow(Refusal);
    expect(() => parseManifest("index\tx.t\ttest/a > b")).toThrow(/unknown kind "index"/);
    expect(() => parseManifest("table\tx.t\ttest/a.db.test.ts")).toThrow(/<file> > <title>/);
    expect(() => parseManifest("table\tx.t\ttest/a.db.test.ts >title")).toThrow(/<file> > <title>/);
    expect(() => parseGap("table\tx.t\textra")).toThrow(/2 non-empty/);
    expect(parseManifest("# c\r\ntable\tx.t\ttest/a.db.test.ts > b > c\r\n")).toEqual([{ kind: "table", name: "x.t", file: "test/a.db.test.ts", title: "b > c", line: 2 }]);
  });

  it("reads the titles a manifest can name, and none built at run time", () => {
    const src = [
      'it("plain", () => {});',
      "it('single \\'quoted\\'', () => {});",
      "test(`template`, () => {});",
      "it(`built ${x}`, () => {});",
      'it.skip("skipped", () => {});',
      'it.skipIf(a === (b))("conditional", () => {});',
      'it.each([1, 2])("each %s", () => {});',
      'describe("not a test", () => {});',
      'audit("not a test either");',
    ].join("\n");
    expect([...listTitles(src)].sort()).toEqual(["conditional", "each %s", "plain", "single 'quoted'", "skipped", "template"]);
  });

  it("lists this repository's tests, and refuses a tree with none", () => {
    const tests = listTests(REPO);
    expect(tests.get("test/coverage-schema.test.ts")?.has("lists this repository's tests, and refuses a tree with none")).toBe(true);
    const tree = plantTree({});
    try {
      expect(() => listTests(tree.root)).toThrow(Refusal);
      expect(() => listTests(tree.root)).toThrow(/could not read/);
      mkdirSync(join(tree.root, "test", "sub"), { recursive: true });
      writeFileSync(join(tree.root, "test", "sub", "x.test.ts"), "describe('no it here', () => {});\n");
      expect(() => listTests(tree.root)).toThrow(/found 1 file\(s\) and 0 title\(s\)/);
      writeFileSync(join(tree.root, "test", "sub", "y.test.ts"), "it('one', () => {});\n");
      expect([...listTests(tree.root).keys()].sort()).toEqual(["test/sub/x.test.ts", "test/sub/y.test.ts"]);
    } finally {
      tree.done();
    }
  });

  it("takes the checkout's head from the newest file, and refuses a tree without one", () => {
    expect(checkoutHead(REPO)).toBeGreaterThanOrEqual(302);
    const tree = plantTree({ "0007_x.sql": "select 1;", "notes.txt": "" });
    try {
      expect(checkoutHead(tree.root)).toBe(7);
    } finally {
      tree.done();
    }
    const empty = plantTree({});
    try {
      expect(() => checkoutHead(empty.root)).toThrow(/no migration file/);
    } finally {
      empty.done();
    }
  });

  it("every manifest and gap row of this repository parses", () => {
    expect(parseManifest(readFileSync(join(REPO, "test", "coverage", "schema.tsv"), "utf8")).length).toBeGreaterThan(0);
    parseGap(readFileSync(join(REPO, "test", "coverage", "gap.tsv"), "utf8"));
  });
});

describe("the fixture kind", () => {
  const sql = readFileSync(join(REPO, "db", "test-fixtures", "vf_test.sql"), "utf8");
  it("reads every vf_test function of the fixture file as one object", () => {
    expect(fixtureObjects(sql).map((o) => o.name)).toEqual([
      "vf_test.armed",
      "vf_test.unfreeze_station_slugs",
      "vf_test.lift_runtime_config_source_bounds",
      "vf_test.lift_postcode_trigger",
      "vf_test.drop_check",
      "vf_test.set_n_distinct",
      "vf_test_clock.now",
      "vf_test.set_clock",
      "vf_test.shadow_put",
      "vf_test.shadow_slow",
      "vf_test.shadow_rows",
      "vf_test.revoke_select",
    ]);
  });
  it("refuses a catalogue that holds a vf_test object, and a fixture file that defines none", () => {
    expect(() => withFixtures([{ kind: "function", name: "vf_test.armed()" }], sql)).toThrow(/the fixtures were installed on it/);
    expect(() => withFixtures([], "select 1;\n")).toThrow(/defines no fixture function/);
    expect(withFixtures([{ kind: "table", name: "public.t" }], sql)).toHaveLength(13);
  });
});
