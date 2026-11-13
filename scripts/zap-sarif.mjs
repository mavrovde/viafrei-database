// ZAP's JSON report as SARIF 2.1.0, for GitHub code scanning.
// Usage: node scripts/zap-sarif.mjs zap.json > zap.sarif
import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const level = (risk) => (Number(risk) >= 3 ? "error" : Number(risk) === 2 ? "warning" : "note");
const alerts = (report.site ?? []).flatMap((s) => s.alerts ?? []);
const rules = new Map();
const results = [];
for (const a of alerts) {
  const id = `zap-${a.pluginid}`;
  rules.set(id, { id, name: a.name, shortDescription: { text: a.name }, helpUri: `https://www.zaproxy.org/docs/alerts/${a.pluginid}/` });
  for (const inst of a.instances?.length ? a.instances : [{ uri: "Dockerfile" }]) {
    results.push({
      ruleId: id,
      level: level(a.riskcode),
      message: { text: `${a.name} at ${inst.uri ?? "?"}` },
      // The scanned surface is the container; anchor findings on the Dockerfile that builds it.
      locations: [{ physicalLocation: { artifactLocation: { uri: "Dockerfile" } } }],
    });
  }
}
process.stdout.write(
  JSON.stringify({ version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "OWASP ZAP baseline", rules: [...rules.values()] } }, results }] }, null, 1),
);
