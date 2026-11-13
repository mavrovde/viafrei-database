/**
 * scripts/zap-verdict.ts: every ZAP alert fails unless zap-rules.tsv marks its
 * rule IGNORE with a reason; the real rules file is the one read.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { alertsOf, ignoredRules, judge, VerdictError } from "../scripts/zap-verdict.js";
import { REPO } from "./helpers.js";

const RULES = readFileSync(join(REPO, "scripts", "zap-rules.tsv"), "utf8");
const report = (...alerts: [string, string][]): unknown => ({
  site: [{ alerts: alerts.map(([pluginid, riskdesc]) => ({ pluginid, name: `rule ${pluginid}`, riskdesc })) }],
});

describe("zap-verdict", () => {
  it("reads the real rules file: its IGNORE rules carry reasons", () => {
    const ignored = ignoredRules(RULES);
    expect([...ignored.keys()].sort()).toEqual(["10049", "10096", "10111", "10202"]);
    for (const reason of ignored.values()) expect(reason.length).toBeGreaterThan(10);
  });

  it("passes a report whose every alert is ignored by the rules file, or that has none", () => {
    expect(judge(report(["10049", "Informational (Medium)"], ["10096", "Low (Low)"]), RULES)).toMatchObject({ ok: true });
    expect(judge({ site: [{}] }, RULES).ok).toBe(true);
  });

  it.each([
    ["an informational alert", "Informational (Low)"],
    ["a low alert", "Low (Medium)"],
    ["a medium alert", "Medium (High)"],
    ["a high alert", "High (Medium)"],
  ])("fails %s the rules file does not decide", (_n, risk) => {
    const r = judge(report(["10049", "Informational (Medium)"], ["10020", risk]), RULES);
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toContain("10020 rule 10020");
  });

  it.each(["WARN", "FAIL", "INFO", "OUTOFSCOPE"])("reads a rule marked %s and does not excuse its alerts", (action) => {
    const tsv = `10020\t${action}\t(seen, not accepted)\n`;
    expect(ignoredRules(tsv).size).toBe(0);
    expect(judge(report(["10020", "Low (Low)"]), tsv).ok).toBe(false);
  });

  it("names every action it accepts when it refuses a line, the five its pattern takes", () => {
    expect(() => ignoredRules("10049\tSKIP\t(why)\n")).toThrow("<IGNORE|WARN|FAIL|INFO|OUTOFSCOPE>");
  });

  it.each([
    ["a line without a reason", "10049\tIGNORE\t()\n"],
    ["an unknown action", "10049\tSKIP\t(why)\n"],
    ["a non-numeric id", "abc\tIGNORE\t(why)\n"],
  ])("refuses a rules file with %s", (_n, tsv) => {
    expect(() => ignoredRules(tsv)).toThrow(VerdictError);
  });

  it("skips blank and comment lines", () => {
    expect(ignoredRules("# header\n\n10049\tIGNORE\t(reason here)\n").size).toBe(1);
  });

  it.each([[null], [{}], [{ site: "x" }], [{ site: [{ alerts: "x" }] }]])("refuses a report %j it cannot read", (r) => {
    expect(() => alertsOf(r)).toThrow(VerdictError);
  });

  describe("the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-zap-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const cli = (...args: string[]): number | null => spawnSync(process.execPath, [join(REPO, "scripts", "zap-verdict.ts"), ...args], { encoding: "utf8" }).status;
    const rules = join(REPO, "scripts", "zap-rules.tsv");
    it("exits 0, 1 and 2", () => {
      const ok = join(dir, "ok.json");
      const bad = join(dir, "bad.json");
      const broken = join(dir, "broken.json");
      writeFileSync(ok, JSON.stringify(report(["10096", "Low (Low)"])));
      writeFileSync(bad, JSON.stringify(report(["10020", "Medium (Medium)"])));
      writeFileSync(broken, "{");
      expect(cli(ok, rules)).toBe(0);
      expect(cli(bad, rules)).toBe(1);
      expect(cli(broken, rules)).toBe(2);
      expect(cli(ok)).toBe(2);
    });
  });

  it("is what zap-scan.sh runs, with ZAP's FAIL and a missed READY not swallowed", () => {
    const scan = readFileSync(join(REPO, "scripts", "zap-scan.sh"), "utf8");
    expect(scan).toContain('node "$ROOT/scripts/zap-verdict.ts" "$OUT/zap.json" "$ROOT/scripts/zap-rules.tsv" || verdict=$?\n');
    expect(scan).toContain('  1) echo "✗ ZAP exited 1: a FAIL-level alert" >&2; exit 1 ;;\n');
    expect(scan).toContain('[ "$ready" = true ] || { echo "✗ the interface never answered READY within 600 s');
    expect(scan).not.toContain("status > 1 ? status : 0");
  });
});
