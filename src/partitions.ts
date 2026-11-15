/**
 * `partitions ensure`: `select ensure_daily_partitions(N);` through psql, or
 * with `--days-back B` / `--from YYYY-MM-DD` the two-argument form (0304),
 * `ensure_daily_partitions(N, B)`, B days behind today instead of three — the
 * past partitions a database needs to hold a dated row. The function itself
 * (part of the schema) creates the daily partitions from three (or B) days
 * behind today through today+N
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

/** How far back: the function's own three days, a number of days, or a start date (the database's current_date decides the count). */
export type Back = { readonly days: number } | { readonly from: string } | null;

/** A real calendar date, YYYY-MM-DD. */
export function parseFromDate(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const ok = m !== null && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString().slice(0, 10) === raw;
  if (!ok) throw new Error(`--from must be a date YYYY-MM-DD, got '${raw}'`);
  return raw;
}

export function ensureStatement(days: number, back: Back = null): string {
  if (!Number.isInteger(days) || days < 0 || days > MAX_DAYS) throw new Error(`days out of range: ${String(days)}`);
  if (back === null) return `select ensure_daily_partitions(${String(days)});`;
  if ("days" in back) {
    if (!Number.isInteger(back.days) || back.days < 0 || back.days > MAX_DAYS) throw new Error(`days back out of range: ${String(back.days)}`);
    return `select ensure_daily_partitions(${String(days)}, ${String(back.days)});`;
  }
  return `select ensure_daily_partitions(${String(days)}, current_date - date '${parseFromDate(back.from)}');`;
}

/** The subject a run is recorded under: `N`, `N back B`, `N from D`. */
export function ensureSubject(days: number, back: Back = null): string {
  return back === null ? String(days) : "days" in back ? `${String(days)} back ${String(back.days)}` : `${String(days)} from ${back.from}`;
}

export type EnsureResult = { readonly exitCode: number; readonly message: string };

export async function ensurePartitions(psql: PsqlRunner, days: number, back: Back = null): Promise<EnsureResult> {
  const r = await psql("", ["-c", ensureStatement(days, back)]);
  const what = back === null ? String(days) : "days" in back ? `${String(days)}, ${String(back.days)}` : `${String(days)}, from ${back.from}`;
  if (r.code !== 0) {
    const line = r.stderr.split("\n").find((l) => l.trim() !== "") ?? "(no message)";
    return { exitCode: r.code, message: `✗ ensure_daily_partitions(${what}) failed: ${line.slice(0, 400)}` };
  }
  const since = back === null ? "" : "days" in back ? `, from today-${String(back.days)}` : `, from ${back.from}`;
  return { exitCode: 0, message: `✓ partitions ensured for today+${String(days)}${since}` };
}
