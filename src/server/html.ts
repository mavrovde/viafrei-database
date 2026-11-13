/**
 * The interface's pages: server-rendered, no script, one stylesheet served
 * from the same origin (CSP `style-src 'self'`). Every value that reaches the
 * page passes through `esc`. Pure, so the pages are unit tests.
 */
import type { Diagnostics } from "../diagnostics.js";
import type { RunRecord, Snapshot } from "../service.js";

export function esc(v: unknown): string {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

export function bytes(n: number): string {
  const units = ["B", "kB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i] ?? "B"}`;
}

const when = (d: Date | null | undefined): string => (d == null ? "—" : new Date(d).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC"));
const day = (d: Date | null | undefined): string => (d == null ? "—" : new Date(d).toISOString().slice(0, 10));

/** The few design tokens this page uses, as plain values, light and dark. */
export const STYLE = `:root{--bg:#f7f7f4;--fg:#1d1d1b;--muted:#5b5b57;--line:#d9d9d2;--ok:#1d6b3a;--bad:#a1261d;--warn:#8a5a00;--accent:#0b4f8a}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecece6;--muted:#a7a7a0;--line:#33332f;--ok:#6fcf8f;--bad:#ff8a7f;--warn:#e7b85a;--accent:#8ab8ea}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
main{max-width:72rem;margin:0 auto;padding:1rem 1.25rem 3rem}
h1{font-size:1.4rem;margin:.5rem 0}h2{font-size:1.1rem;margin:1.6rem 0 .5rem;border-bottom:1px solid var(--line)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{text-align:left;padding:.2rem .5rem;border-bottom:1px solid var(--line);vertical-align:top}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.muted{color:var(--muted)}
pre{white-space:pre-wrap;background:transparent;border:1px solid var(--line);padding:.5rem}
form{display:inline-block;margin:.2rem .4rem .2rem 0}button,input{font:inherit}button{color:var(--accent)}`;

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><link rel="stylesheet" href="/style.css"></head><body><main>${body}</main></body></html>`;
}

function run(r: RunRecord | null, label: string): string {
  if (r === null) return `<p class="muted">${esc(label)}: none yet</p>`;
  return `<p>${esc(label)}: <strong class="${r.ok ? "ok" : "bad"}">${r.ok ? "ok" : "failed"}</strong> — ${esc(r.action)} ${esc(r.subject)} (${esc(r.trigger)}), started ${esc(when(r.startedAt))}, ${esc(r.durationMs)} ms</p><pre>${esc(r.lines.join("\n"))}</pre>`;
}

function table(head: readonly string[], rows: readonly (readonly unknown[])[]): string {
  if (rows.length === 0) return `<p class="muted">none</p>`;
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

export type Owner = { readonly signedIn: false; readonly enabled: boolean } | { readonly signedIn: true; readonly csrf: string };

export const ACTIONS = ["migrate", "partitions", "analyze", "check"] as const;
export type Action = (typeof ACTIONS)[number];

function ownerBlock(owner: Owner): string {
  if (!owner.signedIn) {
    if (!owner.enabled) return `<p class="muted">Actions are switched off here (no owner token configured). Diagnostics are read-only.</p>`;
    return `<form method="post" action="/login"><label>Owner token <input type="password" name="token" autocomplete="current-password" required minlength="16" maxlength="512"></label> <button>Sign in for actions</button></form>`;
  }
  const csrf = `<input type="hidden" name="csrf" value="${esc(owner.csrf)}">`;
  return [
    `<form method="get" action="/confirm"><input type="hidden" name="action" value="migrate"><button>migrate…</button></form>`,
    `<form method="get" action="/confirm"><input type="hidden" name="action" value="partitions"><label>days <input name="subject" value="30" size="3" pattern="[0-9]{1,3}"></label> <button>partitions ensure…</button></form>`,
    `<form method="get" action="/confirm"><input type="hidden" name="action" value="analyze"><label>table <input name="subject" size="28" pattern="[a-z_][a-z0-9_.]{0,126}" required></label> <button>analyze…</button></form>`,
    `<form method="get" action="/confirm"><input type="hidden" name="action" value="check"><button>check…</button></form>`,
    `<form method="post" action="/logout">${csrf}<button>Sign out</button></form>`,
  ].join("");
}

export function statusPage(s: Snapshot, d: Diagnostics | null, dErr: string | null, owner: Owner, notice: string | null): string {
  const r = s.readiness;
  const schema = s.schema;
  const parts: string[] = [`<h1>viafrei database</h1>`];
  if (notice !== null) parts.push(`<p class="warn">${esc(notice)}</p>`);
  parts.push(
    `<p>Readiness: <strong class="${r.ready ? "ok" : "bad"}">${r.ready ? "READY" : "NOT READY"}</strong> — ${esc(r.detail)}. Image head ${esc(s.imageHead)}, database head ${esc(schema?.databaseHead ?? "?")}, ${esc(schema?.pending.length ?? "?")} pending, checked ${esc(when(s.checkedAt))}${s.busy !== null ? `, <span class="warn">running: ${esc(s.busy)}</span>` : ""}.</p>`,
  );
  if (schema !== null && schema.ahead.length > 0) parts.push(`<p class="warn">The ledger holds ${esc(schema.ahead.length)} version(s) newer than this image (up to ${esc(schema.ahead[schema.ahead.length - 1])}).</p>`);
  if (schema !== null && schema.mismatches.length > 0) parts.push(table(["file", "applied checksum", "file checksum"], schema.mismatches.map((m) => [m.name, m.applied, m.file])));
  if (schema !== null && schema.pending.length > 0) parts.push(`<p>Pending: ${esc(schema.pending.map((f) => f.name).join(", "))}</p>`);
  parts.push(`<h2>Actions</h2>`, ownerBlock(owner), run(s.lastAction, "Last action"));
  parts.push(`<h2>Last migration run</h2>`, run(s.lastMigrate, "Migrate"));
  if (d === null) {
    parts.push(`<h2>Diagnostics</h2><p class="bad">The database could not be read: ${esc(dErr ?? "unknown")}</p>`);
    return page("viafrei database", parts.join(""));
  }
  parts.push(
    `<h2>Versions</h2>`,
    table(["database", "postgres", "postgis", "server time"], [[d.versions.database, d.versions.postgres, d.versions.postgis ?? "not installed", when(d.versions.now)]]),
    `<h2>Size</h2><p>${esc(bytes(d.sizeBytes))} in total. Largest relations (a partitioned table counts its partitions):</p>`,
    table(["schema", "relation", "kind", "size"], d.largest.map((x) => [x.schema, x.name, x.kind, bytes(x.bytes)])),
    `<h2>Partition window per tick table</h2>`,
    table(
      ["table", "partitions", "from", "to", "today", "tomorrow", "default", "rows in default (est.)"],
      d.partitions.map((p) => [`${p.schema}.${p.name}`, p.partitions, day(p.oldest_from), day(p.newest_to), p.covers_now ? "yes" : "NO", p.covers_tomorrow ? "yes" : "NO", p.has_default ? "yes" : "NO", p.default_rows_estimate]),
    ),
    `<h2>Connections by role and state</h2>`,
    table(["role", "state", "count"], d.connections.map((c) => [c.role, c.state, c.count])),
    `<h2>Long-running queries (over 30 s)</h2>`,
    table(["pid", "role", "state", "seconds", "waiting on", "query (literals hidden)"], d.longQueries.map((q) => [q.pid, q.role, q.state, q.seconds, [q.wait_event_type, q.wait_event].filter(Boolean).join("/"), q.query])),
    `<h2>Waiting locks</h2>`,
    table(["pid", "role", "blocked by", "lock", "mode", "relation", "seconds"], d.locks.map((l) => [l.pid, l.role, l.blocked_by.join(", "), l.locktype, l.mode, l.relation ?? "—", l.seconds ?? "—"])),
    `<h2>Autovacuum and bloat</h2><p>${esc(d.vacuumRunning)} vacuum(s) running. Most dead tuples:</p>`,
    table(["table", "live", "dead", "dead %", "last autovacuum", "last autoanalyze", "autovacuums"], d.vacuum.map((v) => [`${v.schema}.${v.name}`, v.live, v.dead, v.dead_pct, when(v.last_autovacuum), when(v.last_autoanalyze), v.autovacuums])),
    `<p>Oldest transaction ids (wraparound):</p>`,
    table(["relation", "xid age"], d.wraparound.map((w) => [`${w.schema}.${w.name}`, w.xid_age])),
    `<h2>Newest ledger rows</h2>`,
    table(["version", "name", "applied at"], d.ledgerTail.map((l) => [l.version, l.name, when(l.applied_at)])),
  );
  return page("viafrei database", parts.join(""));
}

export function confirmPage(action: Action, subject: string, csrf: string, confirm: string): string {
  const what = action === "partitions" ? `partitions ensure for today+${subject}` : action === "analyze" ? `analyze ${subject}` : action;
  return page(
    "confirm",
    `<h1>Confirm: ${esc(what)}</h1><p>This runs on the production database. It is safe and idempotent; it drops nothing. The confirmation is valid for two minutes and once.</p>
<form method="post" action="/action"><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="confirm" value="${esc(confirm)}"><input type="hidden" name="action" value="${esc(action)}"><input type="hidden" name="subject" value="${esc(subject)}"><button>Run ${esc(what)}</button></form> <a href="/">Cancel</a>`,
  );
}
