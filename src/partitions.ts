/**
 * `partitions ensure`: `select ensure_daily_partitions(N);`
 * through psql. The function itself (part of the schema)
 * creates the daily partitions from three days behind today through today+N
 * for every range-partitioned table keyed on `observed_at`, and raises when
 * the catalogue disagrees with `partition_settings`. Nothing here drops a
 * partition: retention is the operator's job, outside this service.
 */
import type { PsqlRunner } from "./psql.js";

/** The default for a one-off run; `serve` keeps 30 days ahead. */
export const DEFAULT_CLI_DAYS = 7;
export const DEFAULT_SERVE_DAYS = 30;
export const MAX_DAYS = 400;

export function partitionDays(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`the number of days must be a whole number, got '${raw}'`);
  const n = Number(raw.trim());
  if (n > MAX_DAYS) throw new Error(`the number of days must be at most ${String(MAX_DAYS)}, got ${String(n)}`);
  return n;
}

export function ensureStatement(days: number): string {
  if (!Number.isInteger(days) || days < 0 || days > MAX_DAYS) throw new Error(`days out of range: ${String(days)}`);
  return `select ensure_daily_partitions(${String(days)});`;
}

export type EnsureResult = { readonly exitCode: number; readonly message: string };

export async function ensurePartitions(psql: PsqlRunner, days: number): Promise<EnsureResult> {
  const r = await psql("", ["-c", ensureStatement(days)]);
  if (r.code !== 0) {
    const line = r.stderr.split("\n").find((l) => l.trim() !== "") ?? "(no message)";
    return { exitCode: r.code, message: `✗ ensure_daily_partitions(${String(days)}) failed: ${line.slice(0, 400)}` };
  }
  return { exitCode: 0, message: `✓ partitions ensured for today+${String(days)}` };
}
