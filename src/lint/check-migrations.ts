/**
 * The migration lint. Rules, each a failure:
 *   1. filename NNNN_slug.sql: the shell's glob `[0-9][0-9][0-9][0-9]_[a-z0-9_]*.sql`
 *      read in the C locale, so `0001_a-B.sql` passes (the `*` takes anything
 *      after one slug character) and `0001_.sql` does not (no slug character)
 *   2. numbers strictly increasing by exactly 1, no gaps, no duplicates —
 *      from 0001, or from the baseline's head + 1 when db/baseline exists;
 *      a file at or below that head is allowed only as a CARRIED file (its
 *      name and checksum equal to its ledger.tsv row, the carried files a
 *      run without a gap up to the head — see src/migrations/baseline.ts)
 *   B. db/baseline, when present: a valid ledger.tsv (contiguous from 1) and
 *      exactly one NNNN_baseline.sql numbered at its last version; under
 *      rule 4 both are frozen once on origin/main, like an applied file;
 *      an optional aliases.tsv must parse against that ledger (it is not
 *      frozen: a row is added when a database is found holding an edited
 *      file's checksum)
 *   3. every file has a `-- rollback:` note
 *   4. a file already present on origin/main is byte-identical (never edited)
 *   5. a rollback note naming `schema_migrations where version = N` names THIS file's number
 *   5b. a rollback note naming `schema_migrations where name like '<pat>'` matches THIS file
 *   5c. a rollback note says how to remove its OWN ledger row (or is irreversible);
 *       five pre-rule files are grandfathered by name and the list only shrinks
 *   6. the file ends in a newline (the migrate step appends the ledger insert)
 *   7. a file that RUNS something `concurrently` carries a `-- no-transaction:` marker line
 *      (`refresh materialized view concurrently` is not such a statement: PostgreSQL
 *      runs it inside a transaction block and inside a function)
 *   8. a marker line is within the first 20 lines
 *   9. a marker on a file that needs nothing is refused
 *  10. a marked file is idempotent
 *
 * Rule 4's PRECONDITION is told apart in three states: the
 * ref resolves (rule 4 runs and the tail says on how many files); not a git
 * checkout or no `origin` remote (announced, not applicable); an `origin` but
 * no `origin/main` (a shallow fetch) — REFUSED, exit 1.
 *
 * The file reading and the git reading are seams (`LintIo`) so every rule is a
 * unit test over planted inputs.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ALIASES_TSV, BASELINE_COMPANIONS, BASELINE_FILE, BaselineError, carriedFault, LEDGER_TSV, parseAliasesTsv, parseLedgerTsv, type LedgerRow } from "../migrations/baseline.js";
import { sha256Hex } from "../migrations/files.js";

export const LEDGER_GRANDFATHERED = new Set(["0003_fuel_watch_asked.sql", "0004_fuel_health.sql", "0005_fuel_detail.sql", "0008_transit_delays_licence.sql", "0019_status_role.sql"]);
export const BASE_REF = "origin/main";

export type BaseState = { kind: "ok" } | { kind: "absent"; note: string } | { kind: "refuse" };

/** The two directories the lint reads under db/. */
export type LintDir = "migrations" | "baseline";

export type LintIo = {
  /** File names in db/<dir> (for migrations: ending in .sql), or null when the directory does not exist. */
  readonly list: (dir: LintDir) => string[] | null;
  readonly read: (dir: LintDir, name: string) => Buffer;
  readonly base: () => BaseState;
  /** The file's git blob id on the base ref, or null when it is not there. */
  readonly baseBlob: (dir: LintDir, name: string) => string | null;
};

export type LintResult = { readonly exitCode: number; readonly lines: readonly string[] };

/** The shell's glob `[0-9][0-9][0-9][0-9]_[a-z0-9_]*.sql` in the C locale, exactly. */
export const SLUG = /^[0-9]{4}_[a-z0-9_].*\.sql$/s;

/** SQL LIKE as the shell's case glob: `%` is `*`, everything else literal. */
export function likeMatches(pattern: string, name: string): boolean {
  const re = new RegExp(`^${pattern.split("%").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(name);
}

/**
 * Rule 6, the lock bound (#31 item 6): from this number on, a file that takes
 * a write-blocking lock on a table it did not create itself must set
 * `set local lock_timeout` before the first such statement. Without it the
 * statement queues behind a writer's lock and every later writer queues behind
 * it; with it the file gives up with 55P03 and `migrate` retries it
 * (DB_MIGRATE_LOCK_ATTEMPTS, DB_MIGRATE_LOCK_PAUSE_S).
 *
 * The statements it recognises: a plain (not `concurrently`) `create index`
 * on, `alter table`, `lock table`, `truncate`, `create trigger` on and
 * `drop trigger … on` a table the file did not create; a plain `drop index`
 * and a plain `reindex` (the table is not named, so always); `create or
 * replace view` (an existing view is replaced under an exclusive lock); and
 * dynamic `execute format('alter …')`, whose target is a placeholder, so
 * always.
 *
 * Function and procedure bodies are not read: what a body runs, it runs when
 * it is CALLED, under the caller's bound, not when the file is applied. A DO
 * block is applied and is read. What it cannot see, and a reviewer must:
 * dynamic SQL built any other way (`execute 'alter …' || …`, a format string
 * held in a variable), a function the file itself calls at apply time that
 * locks (`select f()`, `perform f()` in a DO block),
 * `drop view`, `drop table`, `alter view`/`alter index`/`alter materialized
 * view`, `refresh materialized view`, `comment on` and `grant`/`revoke`.
 *
 * The files before it were written without the rule and are not judged;
 * 0294 to 0306 all satisfy it.
 */
export const LOCK_RULE_FROM = 294;

const REL = String.raw`([a-z0-9_."]+)`;

/** The first statement of a text that takes a write-blocking lock on a table the text did not create, or null. */
export function lockingStatement(source: string): { readonly index: number; readonly statement: string } | null {
  const text = blankFunctionBodies(source);
  // A word inside a string literal is not a statement; only the dynamic-alter arm reads into one.
  const code = text.replace(/'(?:[^']|'')*'/g, (l) => `'${" ".repeat(l.length - 2)}'`);
  const own = new Set([...code.matchAll(/create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/gi)].map((m) => bare(m[1] ?? "")));
  const found: { index: number; statement: string }[] = [];
  const onTable = (re: RegExp): void => {
    for (const m of code.matchAll(re)) if (!own.has(bare(m[1] ?? ""))) found.push({ index: m.index, statement: m[0] });
  };
  const always = (re: RegExp, over = code): void => {
    for (const m of over.matchAll(re)) found.push({ index: m.index, statement: m[0] });
  };
  onTable(new RegExp(String.raw`\bcreate\s+(?:unique\s+)?index\s+(?!concurrently\b)(?:if\s+not\s+exists\s+)?[a-z0-9_"]*\s*on\s+(?:only\s+)?${REL}`, "gi"));
  onTable(new RegExp(String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${REL}`, "gi"));
  // lock and truncate as a statement: at the start of a line or after a semicolon, so a word in a literal is not one
  onTable(new RegExp(String.raw`(?<=^|;)[^\S\n]*lock\s+(?:table\s+)?(?:only\s+)?${REL}`, "gim"));
  onTable(new RegExp(String.raw`(?<=^|;)[^\S\n]*truncate\s+(?:table\s+)?(?:only\s+)?${REL}`, "gim"));
  onTable(new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+[a-z0-9_"]+[\s\S]*?\son\s+${REL}`, "gi"));
  onTable(new RegExp(String.raw`\bdrop\s+trigger\s+(?:if\s+exists\s+)?[a-z0-9_"]+\s+on\s+${REL}`, "gi"));
  always(/\bdrop\s+index\s+(?!concurrently\b)(?:if\s+exists\s+)?[a-z0-9_."]+/gi);
  always(/\breindex\s+(?:\([^)]*\)\s*)?(?:table|index|schema|database|system)\s+(?!concurrently\b)[a-z0-9_."]+/gi);
  always(/\bcreate\s+or\s+replace\s+view\s+[a-z0-9_."]+/gi);
  always(/\bexecute\s+format\s*\(\s*'\s*alter\s+[a-z]+/gi, text);
  return found.sort((a, b) => a.index - b.index)[0] ?? null;
}

/** The text with every function or procedure body (`as $tag$ … $tag$`) blanked to spaces, offsets kept: a body runs when it is called, not when the file is applied. A DO block is applied, and stays. */
export function blankFunctionBodies(text: string): string {
  return text.replace(/(\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\b[\s\S]*?\bas\s+)(\$[a-z_]*\$)([\s\S]*?)(\2)/gi, (_m, head: string, open: string, body: string, close: string) => head + open + body.replace(/[^\n]/g, " ") + close);
}

const bare = (name: string): string => {
  const n = name.replaceAll('"', "").toLowerCase();
  return n.includes(".") ? n : `public.${n}`;
};

const stripComments = (text: string): string => text.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

export function lint(io: LintIo): LintResult {
  const lines: string[] = [];
  const names = io.list("migrations");
  const baselineNames = io.list("baseline");
  if (names === null && baselineNames === null) return { exitCode: 0, lines: ["✓ no db/migrations directory yet"] };
  const base = io.base();
  if (base.kind === "refuse") {
    return {
      exitCode: 1,
      lines: [
        `✗ ${BASE_REF} does not resolve, but this checkout HAS an origin remote.`,
        "  Rule 4 — a migration already applied and then EDITED — cannot run, and",
        "  skipping it would let an edited migration reach a database that already applied it.",
        "  In CI: fetch the full history (fetch-depth: 0). Locally:  git fetch origin main",
      ],
    };
  }
  if (base.kind === "absent") lines.push(`note: ${base.note}`);
  const sorted = [...(names ?? [])].sort();
  let problems = 0;
  const fail = (m: string): void => {
    problems += 1;
    lines.push(`  ✗ ${m}`);
  };
  let compared = 0;
  // Rule B: the baseline, when there is one. Its head is where the files start.
  let baselineHead = 0;
  let ledgerRows: LedgerRow[] = [];
  if (baselineNames !== null) {
    const sqls = baselineNames.filter((n) => BASELINE_FILE.test(n));
    const stray = baselineNames.filter((n) => !BASELINE_COMPANIONS.includes(n) && !BASELINE_FILE.test(n) && !n.startsWith("."));
    for (const n of stray) fail(`db/baseline/${n}: only ${BASELINE_COMPANIONS.join(", ")} and one NNNN_baseline.sql belong in db/baseline`);
    if (!baselineNames.includes(LEDGER_TSV)) fail(`db/baseline: ${LEDGER_TSV} is missing`);
    else {
      try {
        ledgerRows = parseLedgerTsv(io.read("baseline", LEDGER_TSV).toString("utf8"));
        baselineHead = ledgerRows.length;
      } catch (e) {
        if (!(e instanceof BaselineError)) throw e;
        fail(`db/baseline/${e.message}`);
      }
    }
    if (baselineNames.includes(ALIASES_TSV) && ledgerRows.length > 0) {
      try {
        parseAliasesTsv(io.read("baseline", ALIASES_TSV).toString("utf8"), ledgerRows);
      } catch (e) {
        if (!(e instanceof BaselineError)) throw e;
        fail(`db/baseline/${e.message}`);
      }
    }
    if (sqls.length !== 1) fail(`db/baseline: expected exactly one NNNN_baseline.sql, found ${String(sqls.length)}`);
    const sql = sqls[0];
    if (sql !== undefined && baselineHead > 0 && Number.parseInt(sql.slice(0, 4), 10) !== baselineHead) {
      fail(`db/baseline/${sql}: must be numbered ${String(baselineHead).padStart(4, "0")}, the last version in ${LEDGER_TSV}`);
    }
    if (base.kind === "ok") {
      for (const n of [LEDGER_TSV, ...sqls]) {
        const was = io.baseBlob("baseline", n);
        if (was === null) continue;
        compared += 1;
        if (was !== gitBlobId(io.read("baseline", n))) fail(`db/baseline/${n}: already on ${BASE_REF} and was EDITED — the baseline is frozen; write a migration after it instead`);
      }
    }
  }
  if (sorted.length === 0 && problems === 0) {
    const rule4 = base.kind === "ok" ? `rule 4 compared ${String(compared)} against ${BASE_REF}` : `rule 4 NOT applicable: ${base.note}`;
    return { exitCode: 0, lines: [...lines, baselineNames === null ? "✓ no migrations yet" : `✓ migrations ok (baseline 1..${String(baselineHead)}, no file after it yet; ${rule4})`] };
  }
  let expected = baselineHead + 1;
  // Carried files (see the header, rule 2): judged as a run, then linted like any other file.
  const low = baselineHead > 0 ? sorted.filter((n) => SLUG.test(n) && Number.parseInt(n.slice(0, 4), 10) <= baselineHead) : [];
  if (low.length > 0) {
    const fault = carriedFault(
      baselineHead,
      ledgerRows,
      low.map((n) => ({ version: Number.parseInt(n.slice(0, 4), 10), name: n, checksum: sha256Hex(io.read("migrations", n)) })),
    );
    if (fault !== null) fail(fault);
  }
  let grandfathered = 0;
  let ledgered = 0;
  for (const name of sorted) {
    if (!SLUG.test(name)) {
      fail(`${name}: must match NNNN_slug.sql`);
      continue;
    }
    const bytes = io.read("migrations", name);
    const text = bytes.toString("utf8");
    const num = Number.parseInt(name.slice(0, 4), 10);
    // A file at or below the head that is not carried has had its reason above.
    if (num !== expected && !(baselineHead > 0 && num <= baselineHead)) fail(`${name}: expected number ${String(expected).padStart(4, "0")} (strictly +1, no gaps, no duplicates)`);
    expected = num + 1;
    if (!text.includes("-- rollback:")) fail(`${name}: missing a '-- rollback:' note (how to undo, or 'irreversible: …')`);
    let ledger = false;
    for (const m of text.matchAll(/schema_migrations[^\S\n]+where[^\S\n]+version[^\S\n]*=[^\S\n]*([0-9]+)/g)) {
      ledger = true;
      const v = Number.parseInt(m[1] ?? "", 10);
      if (v !== num) fail(`${name}: a rollback note says 'schema_migrations where version = ${m[1] ?? ""}' but this file is ${String(num)} — following it would delete migration ${String(v)}'s ledger row and leave this one's behind`);
    }
    for (const m of text.matchAll(/schema_migrations[^\S\n]+where[^\S\n]+name[^\S\n]+like[^\S\n]*'([^'\n]*)'/g)) {
      ledger = true;
      const pat = m[1] ?? "";
      if (!likeMatches(pat, name)) fail(`${name}: a rollback note says "schema_migrations where name like '${pat}'", which does not match this file — following it would delete another migration's ledger row and leave this one's behind`);
    }
    const rollbackLines = text.split("\n").filter((l) => l.toLowerCase().includes("-- rollback:"));
    if (ledger || rollbackLines.some((l) => /irreversible/i.test(l))) ledgered += 1;
    else if (LEDGER_GRANDFATHERED.has(name)) grandfathered += 1;
    else
      fail(
        `${name}: the rollback note never says how to delete its own ledger row — add 'delete from schema_migrations where version = ${String(num)};' (or the 'name like' form, or say the migration is irreversible). Undoing the objects and leaving the row behind makes the migrate step treat this migration as applied for ever`,
      );
    if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) fail(`${name}: does not end in a newline — the migrate step appends the ledger insert after these bytes, and a trailing '--' comment would swallow it`);
    const marked = /^-- no-transaction:/m.test(text);
    if (!marked && /concurrently/i.test(stripComments(text).replace(/\brefresh\s+materialized\s+view\s+concurrently\b/gi, ""))) {
      fail(`${name}: runs something 'concurrently', which PostgreSQL refuses inside a transaction, but carries no '-- no-transaction:' line of its own — the migrate step would wrap it in begin/commit and the statement would fail on the host, mid-deploy`);
    }
    if (marked) {
      const first20 = text.split("\n").slice(0, 20);
      if (!first20.some((l) => /^-- no-transaction:/.test(l))) {
        fail(`${name}: has a '-- no-transaction:' note, but not as a line of its own within the first 20 lines — the migrate step would wrap it in a transaction anyway and 'create index concurrently' would fail in production`);
      }
      if (!/concurrently/i.test(text)) fail(`${name}: is marked '-- no-transaction:' but runs nothing that needs it — the marker costs atomicity, so it is only for statements PostgreSQL refuses inside a transaction`);
      if (!/if not exists|or replace|\bdrop\s+index\s+concurrently\s+if\s+exists\b/i.test(text)) fail(`${name}: is marked '-- no-transaction:' and so can half-apply and be retried from the top — every statement in it must be idempotent ('if not exists' / 'or replace' / 'drop index concurrently if exists')`);
    }
    if (num >= LOCK_RULE_FROM) {
      const code = stripComments(text);
      const locking = lockingStatement(code);
      const bound = /set\s+local\s+lock_timeout\b/i.exec(code);
      if (locking !== null && (bound === null || bound.index > locking.index)) {
        fail(
          `${name}: '${locking.statement.replace(/\s+/g, " ")}' locks a table this file did not create, with no 'set local lock_timeout' before it — it would queue behind a writer and every later writer behind it; set the bound first (migrate retries a 55P03)`,
        );
      }
    }
    if (base.kind === "ok") {
      const was = io.baseBlob("migrations", name);
      if (was !== null) {
        compared += 1;
        if (was !== gitBlobId(bytes)) fail(`${name}: already on ${BASE_REF} and was EDITED — write a new migration instead`);
      }
    }
  }
  const rule4 = base.kind === "ok" ? `rule 4 compared ${String(compared)} against ${BASE_REF}` : `rule 4 NOT applicable: ${base.note}`;
  const rule5c = `rule 5c: ${String(ledgered)} file(s) name their ledger row, ${String(grandfathered)} grandfathered`;
  const carriedNote = low.length > 0 ? ` (${String(low.length)} carried)` : "";
  const counted = baselineHead > 0 ? `baseline 1..${String(baselineHead)}${carriedNote} + ${String(expected - 1 - baselineHead)} file(s)` : `${String(expected - 1)} file(s)`;
  if (problems === 0) return { exitCode: 0, lines: [...lines, `✓ migrations ok (${counted}; ${rule4}; ${rule5c})`] };
  return { exitCode: 1, lines: [...lines, "", `✗ ${String(problems)} migration problem(s)`] };
}

function git(root: string, args: string[]): { ok: boolean; out: Buffer } {
  try {
    return { ok: true, out: execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }) };
  } catch {
    return { ok: false, out: Buffer.alloc(0) };
  }
}

/** git's object id for a blob of these bytes (sha1 of "blob <len>\0" + bytes): equal ids mean equal bytes. */
export function gitBlobId(bytes: Buffer): string {
  return createHash("sha1").update(`blob ${String(bytes.length)}\0`).update(bytes).digest("hex");
}

/** The real seams: the files under `root/db/{migrations,baseline}` and git in `root`. */
export function fsIo(root: string): LintIo {
  const dirOf = (d: LintDir): string => join(root, "db", d);
  const blobs = new Map<LintDir, Map<string, string>>();
  return {
    list: (d) => {
      if (!existsSync(dirOf(d))) return null;
      const all = readdirSync(dirOf(d));
      return d === "migrations" ? all.filter((n) => n.endsWith(".sql")) : all;
    },
    read: (d, name) => readFileSync(join(dirOf(d), name)),
    base: () => {
      if (git(root, ["rev-parse", "--verify", "-q", `${BASE_REF}^{commit}`]).ok) return { kind: "ok" };
      if (!git(root, ["rev-parse", "--is-inside-work-tree"]).ok) return { kind: "absent", note: "not a git checkout, so rule 4 (already applied and EDITED) has no base here" };
      if (!git(root, ["remote", "get-url", "origin"]).ok) return { kind: "absent", note: "no 'origin' remote, so rule 4 (already applied and EDITED) has no base here" };
      return { kind: "refuse" };
    },
    baseBlob: (d, name) => {
      // One ls-tree per directory instead of one `git show` per file (one per file took seconds).
      let m = blobs.get(d);
      if (m === undefined) {
        m = new Map();
        const r = git(root, ["ls-tree", "-z", `${BASE_REF}:db/${d}/`]);
        for (const entry of r.out.toString("utf8").split("\0")) {
          const x = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(entry);
          if (x?.[1] !== undefined && x[2] !== undefined) m.set(x[2], x[1]);
        }
        blobs.set(d, m);
      }
      return m.get(name) ?? null;
    },
  };
}
