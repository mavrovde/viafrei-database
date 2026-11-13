/**
 * coverage-summary: the coverage run's totals as a Markdown table, for the
 * CI job summary.
 *
 *   node scripts/coverage-summary.ts coverage/coverage-summary.json >> "$GITHUB_STEP_SUMMARY"
 *   node scripts/coverage-summary.ts --check-badge README.md coverage/coverage-summary.json
 *
 * The second form compares the README's coverage badge with the measured lines
 * figure rounded down, so the badge cannot go stale.
 *
 * Exit 0 = printed (or the badge agrees); 1 = the badge disagrees; 2 = no
 * usable summary or badge (a missing file or one without the four totals is
 * said, never printed as an empty table).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const METRICS = ["lines", "branches", "functions", "statements"] as const;
type Metric = (typeof METRICS)[number];
type Total = { total: number; covered: number; pct: number };

/** The `total` block of a json-summary report, every metric checked. */
export function readTotals(json: string): Record<Metric, Total> {
  const doc = JSON.parse(json) as { total?: Partial<Record<Metric, Partial<Total>>> };
  const out = {} as Record<Metric, Total>;
  for (const m of METRICS) {
    const t = doc.total?.[m];
    if (typeof t?.total !== "number" || typeof t.covered !== "number" || typeof t.pct !== "number") throw new Error(`the summary has no total for ${m}`);
    out[m] = { total: t.total, covered: t.covered, pct: t.pct };
  }
  return out;
}

export function markdown(t: Record<Metric, Total>): string {
  const rows = METRICS.map((m) => `| ${m} | ${t[m].pct.toFixed(2)} % | ${String(t[m].covered)} / ${String(t[m].total)} |`);
  return ["### Coverage (unit and database tests)", "", "| metric | covered | of |", "|---|---:|---:|", ...rows, ""].join("\n");
}

/** The lines figure the README's coverage badge shows, or null when there is no such badge. */
export function badgeLines(readme: string): number | null {
  const m = /!\[coverage\]\(https:\/\/img\.shields\.io\/badge\/coverage-lines%20(\d+)%25-[a-z]+\)/.exec(readme);
  return m?.[1] === undefined ? null : Number(m[1]);
}

/** null when the badge shows the measured lines figure rounded down; else what is wrong. */
export function badgeFault(readme: string, t: Record<Metric, Total>): string | null {
  const shown = badgeLines(readme);
  const measured = Math.floor(t.lines.pct);
  if (shown === null) return "the README has no coverage badge (coverage-lines%20N%25)";
  return shown === measured ? null : `the README's coverage badge says lines ${String(shown)} %, the run measured ${t.lines.pct.toFixed(2)} % (write ${String(measured)})`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [first, second, third] = process.argv.slice(2);
  try {
    if (first === "--check-badge") {
      if (second === undefined || third === undefined) throw new Error("usage: node scripts/coverage-summary.ts --check-badge <README.md> <coverage-summary.json>");
      const fault = badgeFault(readFileSync(second, "utf8"), readTotals(readFileSync(third, "utf8")));
      process.stdout.write(fault === null ? "✓ the coverage badge shows the measured lines figure\n" : `✗ ${fault}\n`);
      process.exit(fault === null ? 0 : 1);
    }
    if (first === undefined) throw new Error("usage: node scripts/coverage-summary.ts <coverage-summary.json>");
    process.stdout.write(`${markdown(readTotals(readFileSync(first, "utf8")))}\n`);
  } catch (e) {
    process.stderr.write(`✗ ${(e as Error).message}\n`);
    process.exit(2);
  }
}
