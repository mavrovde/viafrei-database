/**
 * Apply pending migrations, one file at a time.
 *
 * What goes to psql is fixed byte for byte, because ledgers already written
 * with it must keep matching (test/golden/migrate holds the recorded bytes):
 *
 *   wrapped        "begin;\n" + <file bytes> + "\n" + <ledger insert> + "\n" + "commit;\n"
 *   no-transaction <file bytes> + "\n", then, only if that succeeded, <ledger insert> + "\n"
 *
 * The bare "\n" after the file is load-bearing: a file whose last line is a
 * `--` comment would otherwise comment out the ledger insert and the commit,
 * psql would reach EOF inside an open transaction, the server would roll the
 * migration back, and psql would exit 0.
 *
 * Order and stops: files in name order; an applied file whose
 * checksum differs STOPS the run (exit 1) — files before it have been applied,
 * none after it; a failure that is not a lock timeout stops at once with psql's
 * exit code; a lock timeout (SQLSTATE 55P03, told apart by psql's
 * VERBOSITY=verbose code and never by its words) is retried up to
 * `lockAttempts` times per file with `lockPauseS` between, and on the last one
 * the run stops with 75 (EX_TEMPFAIL).
 */
import type { MigrationFile } from "./files.js";
import type { PsqlRunner } from "../psql.js";
import { compare, type AppliedRow, type SchemaState } from "./plan.js";
import { baselineScript, type Baseline } from "./baseline.js";

export const CREATE_LEDGER =
  "create table if not exists schema_migrations(version int primary key, name text not null, checksum text not null, applied_at timestamptz not null default now());";
export const READ_LEDGER = "select version||' '||checksum from schema_migrations order by version";
export const READ_HEAD = "select coalesce(max(version),0) from schema_migrations";
export const LOCK_TIMEOUT_SQLSTATE = "55P03";
export const EXIT_TEMPFAIL = 75;
const APPLY_ARGS = ["-v", "VERBOSITY=verbose", "-f", "-"] as const;

/** `printf "insert into schema_migrations(version,name,checksum) values (%d,'%s','%s');"` */
export function ledgerInsert(f: Pick<MigrationFile, "version" | "name" | "checksum">): string {
  return `insert into schema_migrations(version,name,checksum) values (${String(f.version)},'${f.name}','${f.checksum}');`;
}

export function wrappedScript(f: MigrationFile): Buffer {
  return Buffer.concat([Buffer.from("begin;\n"), f.bytes, Buffer.from(`\n${ledgerInsert(f)}\ncommit;\n`)]);
}

export function noTransactionScripts(f: MigrationFile): [Buffer, string] {
  return [Buffer.concat([f.bytes, Buffer.from("\n")]), `${ledgerInsert(f)}\n`];
}

/** `<version> <checksum>` lines → rows. A line that does not parse is a ledger that cannot be trusted. */
export function parseLedger(stdout: string): AppliedRow[] {
  const rows: AppliedRow[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const m = /^(\d+) ([0-9a-f]{64}|\S+)$/.exec(line.trim());
    if (m === null) throw new Error(`schema_migrations returned a line that is not '<version> <checksum>': ${JSON.stringify(line.slice(0, 80))}`);
    rows.push({ version: Number(m[1]), checksum: m[2] ?? "" });
  }
  return rows;
}

export type MigrateOptions = {
  readonly psql: PsqlRunner;
  readonly files: readonly MigrationFile[];
  /** The baseline, when the image carries one (db/baseline). */
  readonly baseline?: Baseline | null;
  readonly dryRun?: boolean;
  readonly lockAttempts?: number;
  readonly lockPauseS?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** One line of the run's report; stdout lines and stderr lines are told apart. */
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
};

export type MigrateResult = {
  readonly exitCode: number;
  readonly applied: readonly string[];
  /** The ledger's head after the run, or null when it could not be read. */
  readonly head: number | null;
  readonly before: SchemaState | null;
  readonly message: string;
};

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function readLedger(psql: PsqlRunner): Promise<AppliedRow[]> {
  const r = await psql("", ["-At", "-c", READ_LEDGER]);
  if (r.code !== 0) throw new Error(`schema_migrations could not be read (psql exit ${String(r.code)}): ${firstLine(r.stderr)}`);
  return parseLedger(r.stdout);
}

export async function migrate(o: MigrateOptions): Promise<MigrateResult> {
  const out = o.out ?? ((l: string): void => void process.stdout.write(`${l}\n`));
  const err = o.err ?? ((l: string): void => void process.stderr.write(`${l}\n`));
  const sleep = o.sleep ?? realSleep;
  const attempts = o.lockAttempts ?? 1;
  const pauseS = o.lockPauseS ?? 20;
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error(`DB_MIGRATE_LOCK_ATTEMPTS must be a whole number >= 1, got '${String(attempts)}'`);
  if (!Number.isInteger(pauseS) || pauseS < 0) throw new Error(`DB_MIGRATE_LOCK_PAUSE_S must be a whole number of seconds, got '${String(pauseS)}'`);
  const applied: string[] = [];
  const stop = (exitCode: number, message: string, before: SchemaState | null): MigrateResult => {
    err(message);
    return { exitCode, applied, head: null, before, message };
  };

  const created = await o.psql("", ["-c", CREATE_LEDGER]);
  if (created.code !== 0) return stop(created.code, `✗ schema_migrations could not be created or read: ${firstLine(created.stderr)}`, null);
  let rows: AppliedRow[];
  try {
    rows = await readLedger(o.psql);
  } catch (e) {
    return stop(1, `✗ ${(e as Error).message}`, null);
  }
  const all = [...(o.baseline?.entries ?? []), ...o.files];
  const before = compare(all, rows);
  const appliedSums = new Map(rows.map((r) => [r.version, r.checksum]));
  let n = 0;

  /** One unit (a file or the baseline) through psql, with the lock-timeout retry. Null on success, else the stop. */
  const apply = async (label: string, idempotent: boolean, scripts: readonly (Buffer | string)[]): Promise<MigrateResult | null> => {
    for (let attempt = 1; ; attempt += 1) {
      let code = 0;
      let stderr = "";
      for (const script of scripts) {
        const r = await o.psql(script, APPLY_ARGS);
        code = r.code;
        stderr = r.stderr;
        if (code !== 0) break;
      }
      if (stderr !== "") err(stderr.replace(/\n$/, ""));
      if (code === 0) return null;
      if (!stderr.includes(LOCK_TIMEOUT_SQLSTATE)) return stop(code, `✗ ${label} failed (not a lock timeout): not retried`, before);
      if (attempt >= attempts) {
        return stop(
          EXIT_TEMPFAIL,
          `✗ ${label}: lock timeout (SQLSTATE 55P03) on all ${String(attempts)} attempt(s) — a long transaction holds its table; nothing of this file is applied, every file before it is`,
          before,
        );
      }
      out(
        `  ⚠ ${label}: lock timeout (SQLSTATE 55P03) on attempt ${String(attempt)}/${String(attempts)} — ${idempotent ? "the file is idempotent by its no-transaction note" : "rolled back, nothing of it applied"}; retrying in ${String(pauseS)}s`,
      );
      await sleep(pauseS * 1000);
    }
  };

  // The baseline's versions are checked first: they come before every file.
  const b = o.baseline ?? null;
  const pending: MigrationFile[] = [];
  for (const e of b?.entries ?? []) {
    const sum = appliedSums.get(e.version);
    if (sum !== undefined && sum !== e.checksum) return stop(1, `✗ ${e.name} is applied with a different checksum than the baseline's ledger.tsv — never edit an applied migration`, before);
  }

  if (b !== null) {
    const held = b.entries.filter((e) => appliedSums.has(e.version)).length;
    if (held === 0) {
      if (rows.length > 0) {
        return stop(1, `✗ the ledger holds versions above the baseline but none of 1..${String(b.head)} — this is not a database the baseline can start`, before);
      }
      if (o.dryRun === true) {
        out(`would apply the baseline ${b.name} (versions 1..${String(b.head)})`);
      } else {
        out(`applying the baseline ${b.name} (versions 1..${String(b.head)}, one transaction)`);
        const stopped = await apply(b.name, false, [baselineScript(b, ledgerInsert)]);
        if (stopped !== null) return stopped;
        applied.push(b.name);
      }
      n += b.head;
    } else if (held < b.entries.length) {
      // A ledger holding exactly 1..held, every later version of the baseline
      // carried as a file: those files finish it (see baseline.ts).
      const carried = new Map((b.carried ?? []).map((f) => [f.version, f]));
      const prefix = b.entries.every((e) => appliedSums.has(e.version) === e.version <= held);
      const finish = b.entries.filter((e) => e.version > held).map((e) => carried.get(e.version));
      if (!prefix || finish.some((f) => f === undefined)) {
        const missing = b.entries.find((e) => !appliedSums.has(e.version));
        return stop(
          1,
          `✗ the ledger holds ${String(held)} of the baseline's ${String(b.entries.length)} versions (first missing: ${missing?.name ?? "?"}) — the baseline only starts an EMPTY database, and this image carries no file for every missing version; finish this one with the original migrations first`,
          before,
        );
      }
      pending.push(...(finish as MigrationFile[]));
    }
  }
  pending.push(...o.files);

  for (const f of pending) {
    const sum = appliedSums.get(f.version);
    if (sum !== undefined) {
      if (sum !== f.checksum) return stop(1, `✗ ${f.name} is applied with a different checksum — never edit an applied migration`, before);
      continue;
    }
    if (o.dryRun === true) {
      out(`would apply ${f.name}`);
      n += 1;
      continue;
    }
    out(f.noTransaction ? `applying ${f.name} (no transaction — see the file's -- no-transaction: note)` : `applying ${f.name}`);
    const stopped = f.noTransaction ? await apply(f.name, true, noTransactionScripts(f)) : await apply(f.name, false, [wrappedScript(f)]);
    if (stopped !== null) return stopped;
    applied.push(f.name);
    n += 1;
  }
  const h = await o.psql("", ["-At", "-c", READ_HEAD]);
  const head = h.code === 0 && /^\d+$/.test(h.stdout.trim()) ? Number(h.stdout.trim()) : null;
  const message = `✓ ${String(n)} migration(s) ${o.dryRun === true ? "pending" : "applied"}; head = ${head === null ? "?" : String(head)}`;
  out(message);
  return { exitCode: 0, applied, head, before, message };
}

function firstLine(s: string): string {
  return (s.split("\n").find((l) => l.trim() !== "") ?? "(no message)").slice(0, 300);
}
