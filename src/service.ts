/**
 * The running service: what it knows about the database and the one place an
 * action is started. HTTP and the CLI both go through here.
 *
 *   boot      migrate → partitions ensure (the serve days, 30) → role passwords.
 *             A failed migrate does NOT end the process: the interface stays up
 *             to say why, /ready answers 503, and the migrate is retried with a
 *             backoff (30 s doubling to 10 min). The steps always run in this
 *             order, and READY needs all three.
 *   recheck   every `recheckS` the ledger is read again, so READY follows the
 *             database (a restore, a second writer) and not only this process's
 *             memory.
 *   daily     partitions ensure every `partitionsEveryH`, so the window of
 *             daily partitions keeps moving ahead without anything else.
 *
 * One action at a time in this process (`busy`), and one migrate at a time
 * across processes: a session advisory lock held on a pg connection for the
 * length of the run (`MIGRATE_LOCK_KEY`). A second replica that cannot take it
 * reports "another migrate is running" (exit 75) and applies nothing.
 */
import pg from "pg";
import type { MigrationFile } from "./migrations/files.js";
import { assembleSchema, loadSchema, type Baseline, type Schema } from "./migrations/baseline.js";
import { migrate, type MigrateResult } from "./migrations/migrate.js";
import { compare, readiness, serviceReadiness, type AppliedRow, type Readiness, type SchemaState, type ServiceReadiness } from "./migrations/plan.js";
import { psqlRunner, type PsqlRunner } from "./psql.js";
import { ensurePartitions } from "./partitions.js";
import { applyRolePasswords, type RolesResult } from "./roles.js";
import { analyzeTable, check, type ActionResult } from "./actions.js";
import { collect, type Diagnostics } from "./diagnostics.js";
import type { Config } from "./config.js";
import type { Logger } from "./log.js";

/** pg_try_advisory_lock key of the migrate step: 'vfdbmig1' as a bigint. */
export const MIGRATE_LOCK_KEY = "8531209432493664561";

export type RunRecord = {
  readonly action: "migrate" | "partitions" | "analyze" | "check" | "roles";
  readonly subject: string;
  readonly trigger: "boot" | "owner" | "schedule" | "cli";
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly durationMs: number;
  readonly ok: boolean;
  /** The process exit code a CLI run reports: the step's own (75 for a lock timeout), else 0 or 1. */
  readonly exitCode: number;
  readonly lines: readonly string[];
};

export type Snapshot = {
  readonly readiness: ServiceReadiness;
  readonly schema: SchemaState | null;
  readonly schemaReadiness: Readiness;
  readonly lastMigrate: RunRecord | null;
  readonly lastAction: RunRecord | null;
  readonly roles: RolesResult | null;
  readonly busy: string | null;
  readonly imageHead: number;
  readonly checkedAt: Date | null;
};

export type ServiceDeps = {
  readonly config: Config;
  readonly log: Logger;
  readonly pool?: pg.Pool;
  readonly psql?: PsqlRunner;
  /** The files with no baseline (tests); `schema` wins when both are given. */
  readonly files?: readonly MigrationFile[];
  readonly schema?: Schema;
  readonly now?: () => Date;
};

export class DatabaseService {
  /** Everything readiness compares the ledger with: the baseline's versions, then the files. */
  readonly files: readonly MigrationFile[];
  readonly baseline: Baseline | null;
  private readonly migrationFiles: readonly MigrationFile[];
  readonly pool: pg.Pool;
  private readonly psql: PsqlRunner;
  private readonly now: () => Date;
  private schema: SchemaState | null = null;
  private checkedAt: Date | null = null;
  private steps: { partitions: boolean | null; roles: boolean | "skipped" | null } = { partitions: null, roles: null };
  private lastMigrate: RunRecord | null = null;
  private lastAction: RunRecord | null = null;
  private roles: RolesResult | null = null;
  private busy: string | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly d: ServiceDeps) {
    const schema = d.schema ?? (d.files !== undefined ? assembleSchema(null, d.files) : loadSchema(d.config.migrationsDir, d.config.baselineDir));
    this.files = schema.all;
    this.baseline = schema.baseline;
    this.migrationFiles = schema.files;
    this.pool = d.pool ?? new pg.Pool({ connectionString: d.config.databaseUrl, max: 4, idleTimeoutMillis: 30_000, application_name: "viafrei-database" });
    this.psql = d.psql ?? psqlRunner({ databaseUrl: d.config.databaseUrl, bin: d.config.psqlBin });
    this.now = d.now ?? ((): Date => new Date());
  }

  snapshot(): Snapshot {
    const schemaReadiness = readiness(this.schema);
    return {
      readiness: serviceReadiness(schemaReadiness, this.steps),
      schema: this.schema,
      schemaReadiness,
      lastMigrate: this.lastMigrate,
      lastAction: this.lastAction,
      roles: this.roles,
      busy: this.busy,
      imageHead: this.files.reduce((m, f) => Math.max(m, f.version), 0),
      checkedAt: this.checkedAt,
    };
  }

  /** Read the ledger and compare. A failed read is `schema = null`: not ready, never "probably fine". */
  async refresh(): Promise<void> {
    try {
      const r = await this.pool.query<{ t: string | null }>("select to_regclass('schema_migrations')::text as t");
      const rows: AppliedRow[] = r.rows[0]?.t == null ? [] : (await this.pool.query<AppliedRow>("select version, checksum from schema_migrations order by version")).rows;
      this.schema = compare(this.files, rows);
    } catch (e) {
      this.schema = null;
      this.d.log.warn({ err: (e as Error).message.slice(0, 200) }, "the ledger could not be read");
    }
    this.checkedAt = this.now();
  }

  private async exclusive<T extends { ok: boolean; lines: readonly string[]; exitCode?: number }>(action: RunRecord["action"], subject: string, trigger: RunRecord["trigger"], body: () => Promise<T>): Promise<RunRecord> {
    const startedAt = this.now();
    if (this.busy !== null) {
      return { action, subject, trigger, startedAt, finishedAt: startedAt, durationMs: 0, ok: false, exitCode: 75, lines: [`✗ ${this.busy} is running — one action at a time`] };
    }
    this.busy = action;
    try {
      let res: { ok: boolean; lines: readonly string[]; exitCode?: number };
      try {
        res = await body();
      } catch (e) {
        res = { ok: false, lines: [`✗ ${action} failed: ${(e as Error).message.slice(0, 300)}`] };
      }
      const finishedAt = this.now();
      const rec: RunRecord = { action, subject, trigger, startedAt, finishedAt, durationMs: finishedAt.getTime() - startedAt.getTime(), ok: res.ok, exitCode: res.exitCode ?? (res.ok ? 0 : 1), lines: res.lines };
      this.d.log[rec.ok ? "info" : "error"]({ action, subject, trigger, ok: rec.ok, durationMs: rec.durationMs }, `${action} ${rec.ok ? "done" : "failed"}`);
      if (action === "migrate") this.lastMigrate = rec;
      if (trigger !== "boot") this.lastAction = rec;
      return rec;
    } finally {
      this.busy = null;
      await this.refresh();
    }
  }

  migrate(trigger: RunRecord["trigger"], dryRun = false): Promise<RunRecord> {
    return this.exclusive("migrate", dryRun ? "dry-run" : "-", trigger, async () => {
      const lines: string[] = [];
      const lockClient = await this.pool.connect();
      try {
        const got = (await lockClient.query<{ ok: boolean }>("select pg_try_advisory_lock($1::bigint) as ok", [MIGRATE_LOCK_KEY])).rows[0]?.ok === true;
        if (!got) return { ok: false, lines: ["✗ another migrate is running against this database (advisory lock held) — nothing applied"], exitCode: 75 };
        let r: MigrateResult;
        try {
          r = await migrate({
            psql: this.psql,
            files: this.migrationFiles,
            baseline: this.baseline,
            dryRun,
            lockAttempts: this.d.config.lockAttempts,
            lockPauseS: this.d.config.lockPauseS,
            out: (l) => lines.push(l),
            err: (l) => lines.push(l),
          });
        } finally {
          await lockClient.query("select pg_advisory_unlock($1::bigint)", [MIGRATE_LOCK_KEY]).catch(() => undefined);
        }
        return { ok: r.exitCode === 0, lines, exitCode: r.exitCode };
      } finally {
        lockClient.release();
      }
    });
  }

  ensurePartitions(trigger: RunRecord["trigger"], days = this.d.config.partitionDays): Promise<RunRecord> {
    return this.exclusive("partitions", String(days), trigger, async () => {
      const r = await ensurePartitions(this.psql, days);
      // Not sticky: once boot has run the step, every later ensure (the daily one,
      // or the owner's) sets it, so a failing ensure clears /ready and the next
      // one that succeeds restores it.
      if (trigger === "boot" || this.steps.partitions !== null) this.steps.partitions = r.exitCode === 0;
      return { ok: r.exitCode === 0, lines: [r.message], exitCode: r.exitCode };
    });
  }

  applyRoles(trigger: RunRecord["trigger"]): Promise<RunRecord> {
    return this.exclusive("roles", "-", trigger, async () => {
      const dir = this.d.config.roleSecretDir;
      if (dir === null) {
        this.steps.roles = "skipped";
        return { ok: true, lines: ["role passwords: VF_DB_ROLE_DIR is not set here — skipped"] };
      }
      const lines: string[] = [];
      this.roles = await applyRolePasswords({ psql: this.psql, secretDir: dir, sqlDir: this.d.config.rolesSqlDir, log: (l) => lines.push(l) });
      this.steps.roles = this.roles.ok;
      return { ok: this.roles.ok, lines };
    });
  }

  analyze(table: string, trigger: RunRecord["trigger"]): Promise<RunRecord> {
    return this.exclusive("analyze", table, trigger, () => analyzeTable(this.pool, table));
  }

  check(trigger: RunRecord["trigger"]): Promise<RunRecord> {
    return this.exclusive("check", "-", trigger, (): Promise<ActionResult> => check(this.pool, this.files));
  }

  diagnostics(): Promise<Diagnostics> {
    return collect(this.pool);
  }

  /** The boot sequence; resolves when the service is ready or the first attempt has failed (retries continue on timers). */
  async boot(backoffMs = 30_000): Promise<void> {
    await this.refresh();
    const attempt = async (delay: number): Promise<void> => {
      const m = await this.migrate("boot");
      if (!m.ok) {
        const next = Math.min(delay * 2, 600_000);
        this.d.log.error({ retryInS: Math.round(delay / 1000) }, "boot migrate failed; the service stays up, not ready, and retries");
        this.timers.push(setTimeout(() => void attempt(next), delay));
        return;
      }
      const p = await this.ensurePartitions("boot");
      if (!p.ok) {
        this.timers.push(setTimeout(() => void attempt(Math.min(delay * 2, 600_000)), delay));
        return;
      }
      const r = await this.applyRoles("boot");
      if (!r.ok) this.timers.push(setTimeout(() => void attempt(Math.min(delay * 2, 600_000)), delay));
    };
    await attempt(backoffMs);
  }

  /** The periodic recheck and the daily partitions ensure. */
  schedule(): void {
    this.timers.push(setInterval(() => void this.refresh(), this.d.config.recheckS * 1000));
    this.timers.push(
      setInterval(() => {
        if (this.steps.partitions !== null) void this.ensurePartitions("schedule");
      }, this.d.config.partitionsEveryH * 3_600_000),
    );
    for (const t of this.timers) t.unref();
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    await this.pool.end();
  }
}
