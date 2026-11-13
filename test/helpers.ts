import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PsqlResult, PsqlRunner } from "../src/psql.js";

export const REPO = join(import.meta.dirname, "..");

/** A throwaway tree with db/migrations holding the given files; removed by the returned function. */
export function plantTree(files: Record<string, string | Buffer>): { root: string; dir: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), "vfdb-"));
  const dir = join(root, "db", "migrations");
  mkdirSync(dir, { recursive: true });
  for (const [n, body] of Object.entries(files)) writeFileSync(join(dir, n), body);
  return { root, dir, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** Copies a script of `scripts/` into `root/scripts/` so it resolves ROOT to the planted tree. */
export function plantScript(root: string, name: string): string {
  mkdirSync(join(root, "scripts"), { recursive: true });
  const to = join(root, "scripts", name);
  copyFileSync(join(REPO, "scripts", name), to);
  chmodSync(to, 0o755);
  return to;
}

export type Call = { readonly script: Buffer; readonly args: readonly string[] };

/**
 * A psql that records every call and answers from a ledger it keeps itself:
 * a `-At -c select version||' '||checksum` returns the ledger; a script whose
 * text carries `insert into schema_migrations` appends to it. `fail` decides a
 * call's exit code and stderr before it is recorded as applied.
 */
export function fakePsql(o: { ledger?: string[]; fail?: (script: string, n: number) => PsqlResult | null } = {}): { run: PsqlRunner; calls: Call[]; ledger: string[] } {
  const ledger = [...(o.ledger ?? [])];
  const calls: Call[] = [];
  const run: PsqlRunner = (script, args = []) => {
    const buf = Buffer.isBuffer(script) ? script : Buffer.from(script);
    calls.push({ script: buf, args });
    const text = buf.toString("utf8");
    const forced = o.fail?.(text, calls.length);
    if (forced) return Promise.resolve(forced);
    const c = args.indexOf("-c");
    const sql = c >= 0 ? (args[c + 1] ?? "") : "";
    if (sql.startsWith("select version||")) return Promise.resolve({ code: 0, stdout: ledger.map((l) => `${l}\n`).join(""), stderr: "" });
    if (sql.startsWith("select coalesce(max(version)")) {
      const head = ledger.reduce((m, l) => Math.max(m, Number(l.split(" ")[0])), 0);
      return Promise.resolve({ code: 0, stdout: `${String(head)}\n`, stderr: "" });
    }
    // Every insert in the script: a baseline carries one per version it stands for.
    for (const m of text.matchAll(/insert into schema_migrations\(version,name,checksum\) values \((\d+),'[^']*','([0-9a-f]+)'\);/g)) ledger.push(`${m[1] ?? ""} ${m[2] ?? ""}`);
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };
  return { run, calls, ledger };
}

/** A stub `psql` executable for a shell script: records argv, PGPASSWORD and stdin per call, answers like fakePsql. */
export function stubPsqlBin(root: string, o: { failCalls?: readonly number[] } = {}): { binDir: string; log: string } {
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const log = join(root, "calls");
  mkdirSync(log, { recursive: true });
  const ledger = join(root, "ledger");
  writeFileSync(ledger, "");
  writeFileSync(
    join(binDir, "psql"),
    `#!/usr/bin/env bash
n=$(( $(ls "${log}" | wc -l) / 3 + 1 ))
printf '%s\\n' "$@" > "${log}/$n.args"
printf '%s' "\${PGPASSWORD-<unset>}" > "${log}/$n.pw"
sql=""; prev=""
for a in "$@"; do if [ "$prev" = "-c" ]; then sql="$a"; fi; prev="$a"; done
if [ -n "$sql" ]; then : > "${log}/$n.stdin"; else cat > "${log}/$n.stdin"; fi
case " ${(o.failCalls ?? []).join(" ")} " in *" $n "*) echo "ERROR:  55P03: canceling statement due to lock timeout" >&2; exit 3 ;; esac
case "$sql" in
  "select version||"*) cat "${ledger}" ;;
  "select coalesce(max(version)"*) awk 'BEGIN{m=0} {if ($1+0>m) m=$1+0} END{print m}' "${ledger}" ;;
esac
grep -oE "insert into schema_migrations\\(version,name,checksum\\) values \\([0-9]+,'[^']*','[0-9a-f]+'\\);" "${log}/$n.stdin" 2>/dev/null \\
  | sed -E "s/.*values \\(([0-9]+),'[^']*','([0-9a-f]+)'\\);/\\1 \\2/" >> "${ledger}"
exit 0
`,
  );
  chmodSync(join(binDir, "psql"), 0o755);
  return { binDir, log };
}

export function cleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
