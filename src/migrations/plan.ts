/**
 * What the database holds against what this image carries — and the one
 * answer the cluster waits on: READY or not.
 *
 * Pure: no clock, no socket, no environment. The rules:
 *
 *   * An applied version whose checksum differs from the file's is a MISMATCH.
 *     Migrate stops at it ("never edit an applied migration"), so a mismatch is
 *     never ready and never migrated past.
 *   * A file whose version is not in the ledger is PENDING.
 *   * A ledger version with no file in this image is AHEAD: the database was
 *     migrated by a newer image. Migrate ignores those rows, and so does
 *     readiness — a rolled-back image serves a database whose extra migrations
 *     the previous services were written to tolerate (migrations are additive,
 *     project rules). It is reported, never hidden.
 *   * READY means: the ledger could be read, nothing is pending, nothing
 *     mismatches, and the image carries at least one migration. Nothing else.
 */
import type { MigrationFile } from "./files.js";

export type AppliedRow = { readonly version: number; readonly checksum: string };

export type Mismatch = { readonly name: string; readonly version: number; readonly applied: string; readonly file: string };

export type SchemaState = {
  /** The highest version this image carries; 0 when it carries none. */
  readonly imageHead: number;
  /** The highest version in the ledger; 0 when the ledger is empty. */
  readonly databaseHead: number;
  readonly pending: readonly MigrationFile[];
  readonly mismatches: readonly Mismatch[];
  /** Ledger versions with no file here, ascending. */
  readonly ahead: readonly number[];
  readonly applied: number;
};

export function compare(files: readonly MigrationFile[], rows: readonly AppliedRow[]): SchemaState {
  const byVersion = new Map<number, string>();
  for (const r of rows) byVersion.set(r.version, r.checksum);
  const pending: MigrationFile[] = [];
  const mismatches: Mismatch[] = [];
  let applied = 0;
  for (const f of files) {
    const got = byVersion.get(f.version);
    if (got === undefined) {
      pending.push(f);
    } else if (got !== f.checksum) {
      mismatches.push({ name: f.name, version: f.version, applied: got, file: f.checksum });
    } else {
      applied += 1;
    }
  }
  const carried = new Set(files.map((f) => f.version));
  const ahead = [...byVersion.keys()].filter((v) => !carried.has(v)).sort((a, b) => a - b);
  const imageHead = files.reduce((m, f) => Math.max(m, f.version), 0);
  const databaseHead = rows.reduce((m, r) => Math.max(m, r.version), 0);
  return { imageHead, databaseHead, pending, mismatches, ahead, applied };
}

export type Readiness =
  | { readonly ready: true; readonly reason: "at-head"; readonly head: number }
  | { readonly ready: false; readonly reason: "no-ledger" | "no-migrations" | "pending" | "mismatch"; readonly detail: string };

/** The readiness rule. `state` is null when the ledger could not be read. */
export function readiness(state: SchemaState | null): Readiness {
  if (state === null) return { ready: false, reason: "no-ledger", detail: "the ledger (schema_migrations) could not be read" };
  if (state.imageHead === 0) return { ready: false, reason: "no-migrations", detail: "this image carries no migration" };
  if (state.mismatches.length > 0) {
    const first = state.mismatches[0];
    return { ready: false, reason: "mismatch", detail: `${String(state.mismatches.length)} applied migration(s) differ from this image's files, first ${first?.name ?? "?"}` };
  }
  if (state.pending.length > 0) {
    const first = state.pending[0];
    return { ready: false, reason: "pending", detail: `${String(state.pending.length)} migration(s) pending, first ${first?.name ?? "?"}; image head ${String(state.imageHead)}` };
  }
  return { ready: true, reason: "at-head", head: state.imageHead };
}

/** The boot steps after the migrations: null = not run yet, "skipped" = not configured here. */
export type BootSteps = { readonly partitions: boolean | null; readonly roles: boolean | "skipped" | null };

export type ServiceReadiness = { readonly ready: boolean; readonly detail: string };

/**
 * READY for the cluster: the schema at head AND the boot's partitions ensured
 * AND the role passwords applied (when a role directory is mounted). A
 * workload that waits on /ready therefore never starts against a schema that
 * is behind, a tick table without today's partition, or a role whose password
 * was not set.
 */
export function serviceReadiness(schema: Readiness, steps: BootSteps): ServiceReadiness {
  if (!schema.ready) return { ready: false, detail: `schema not at head: ${schema.detail}` };
  if (steps.partitions === null) return { ready: false, detail: "partitions not ensured yet" };
  if (!steps.partitions) return { ready: false, detail: "partitions ensure failed" };
  if (steps.roles === null) return { ready: false, detail: "role passwords not applied yet" };
  if (steps.roles === false) return { ready: false, detail: "a required role password could not be applied" };
  return { ready: true, detail: `at head ${String(schema.head)}` };
}
