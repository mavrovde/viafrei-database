/**
 * The ZAP baseline's verdict, from its JSON report and scripts/zap-rules.tsv.
 *
 *   node scripts/zap-verdict.ts zap.json scripts/zap-rules.tsv
 *
 * Every alert ZAP raises, at any risk level, fails the scan unless the rules
 * file marks its rule IGNORE with a reason. A rule marked anything else
 * (WARN, FAIL, INFO, OUTOFSCOPE) does not excuse its alerts. Exit 0 pass, 1 an alert not
 * excused, 2 an unreadable report or rules file.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export class VerdictError extends Error {}

export type Alert = { readonly pluginid: string; readonly name: string; readonly riskdesc: string };

/**
 * The rules file: `<plugin id> TAB <IGNORE|WARN|FAIL|INFO|OUTOFSCOPE> TAB (<reason>)`, one per line —
 * the five actions ZAP's own rules file accepts. Only IGNORE changes the verdict here; the other
 * four are read and leave the alert failing the run.
 */
export function ignoredRules(tsv: string): Map<string, string> {
  const ignored = new Map<string, string>();
  for (const [i, raw] of tsv.split("\n").entries()) {
    const line = raw.trimEnd();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(\d+)\t(IGNORE|WARN|FAIL|INFO|OUTOFSCOPE)\t\((.*\S.*)\)$/.exec(line);
    if (m === null) throw new VerdictError(`zap-rules.tsv line ${String(i + 1)} is not '<id> TAB <IGNORE|WARN|FAIL|INFO|OUTOFSCOPE> TAB (<reason>)'`);
    const [, id, action, reason] = m;
    if (id !== undefined && action === "IGNORE" && reason !== undefined) ignored.set(id, reason);
  }
  return ignored;
}

const text = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");

/** Every alert of the report, whatever its risk. */
export function alertsOf(report: unknown): Alert[] {
  if (typeof report !== "object" || report === null || !Array.isArray((report as { site?: unknown }).site)) throw new VerdictError("the ZAP report has no site list");
  const out: Alert[] = [];
  for (const site of (report as { site: unknown[] }).site) {
    const alerts = (site as { alerts?: unknown }).alerts;
    if (alerts === undefined) continue;
    if (!Array.isArray(alerts)) throw new VerdictError("a site's alerts are not a list");
    for (const a of alerts as Record<string, unknown>[]) out.push({ pluginid: text(a["pluginid"]), name: text(a["name"]), riskdesc: text(a["riskdesc"]) });
  }
  return out;
}

export function judge(report: unknown, tsv: string): { readonly ok: boolean; readonly lines: string[] } {
  const ignored = ignoredRules(tsv);
  const alerts = alertsOf(report);
  const open = alerts.filter((a) => !ignored.has(a.pluginid));
  const lines = open.map((a) => `  ✗ ${a.pluginid} ${a.name} (${a.riskdesc}): not decided in scripts/zap-rules.tsv`);
  lines.push(
    open.length === 0
      ? `✓ ZAP baseline: ${String(alerts.length)} alert(s), each excused by an IGNORE rule with its reason`
      : `✗ ZAP baseline: ${String(open.length)} alert(s) that scripts/zap-rules.tsv does not excuse`,
  );
  return { ok: open.length === 0, lines };
}

function main(argv: readonly string[]): number {
  const [reportFile, rulesFile] = argv;
  if (reportFile === undefined || rulesFile === undefined) {
    console.error("usage: node scripts/zap-verdict.ts <zap.json> <zap-rules.tsv>");
    return 2;
  }
  try {
    const r = judge(JSON.parse(readFileSync(reportFile, "utf8")) as unknown, readFileSync(rulesFile, "utf8"));
    for (const l of r.lines) console.log(l);
    return r.ok ? 0 : 1;
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
