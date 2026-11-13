import { describe, expect, it } from "vitest";
import { badgeFault, badgeLines, markdown, readTotals } from "../scripts/coverage-summary.js";

const total = (pct: number) => ({ total: 200, covered: pct * 2, skipped: 0, pct });
const doc = JSON.stringify({ total: { lines: total(91), branches: total(82), functions: total(83), statements: total(88) } });

describe("coverage-summary", () => {
  it("prints the four totals as a Markdown table", () => {
    expect(markdown(readTotals(doc))).toBe(
      [
        "### Coverage (unit and database tests)",
        "",
        "| metric | covered | of |",
        "|---|---:|---:|",
        "| lines | 91.00 % | 182 / 200 |",
        "| branches | 82.00 % | 164 / 200 |",
        "| functions | 83.00 % | 166 / 200 |",
        "| statements | 88.00 % | 176 / 200 |",
        "",
      ].join("\n"),
    );
  });

  it("refuses a summary missing a total rather than print an empty table", () => {
    expect(() => readTotals(JSON.stringify({ total: { lines: total(1) } }))).toThrow("the summary has no total for branches");
    expect(() => readTotals("{}")).toThrow("the summary has no total for lines");
    expect(() => readTotals("not json")).toThrow();
  });

  it("reads the badge and compares it with the measured lines figure rounded down", () => {
    const readme = (n: string): string => `# x\n![coverage](https://img.shields.io/badge/coverage-lines%20${n}%25-brightgreen)\n`;
    const t = readTotals(JSON.stringify({ total: { lines: total(99.9), branches: total(82), functions: total(83), statements: total(88) } }));
    expect(badgeLines(readme("99"))).toBe(99);
    expect(badgeFault(readme("99"), t)).toBeNull();
    expect(badgeFault(readme("100"), t)).toBe("the README's coverage badge says lines 100 %, the run measured 99.90 % (write 99)");
    expect(badgeFault(readme("98"), t)).toMatch(/says lines 98 %/);
    expect(badgeFault("# no badge\n", t)).toBe("the README has no coverage badge (coverage-lines%20N%25)");
  });
});
