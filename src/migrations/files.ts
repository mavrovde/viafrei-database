/**
 * The migration files as the migrate step sees them: which files, in which
 * order, under which version number and with which checksum.
 *
 * These rules are fixed: ledgers (`schema_migrations`) already written hold
 * checksums taken by them. A different checksum rule would make every applied
 * file look edited, and the migrate step would refuse every such database.
 *
 *   * The files are `db/migrations/[0-9][0-9][0-9][0-9]_*.sql`. Nothing else
 *     in the directory is a migration.
 *   * They are applied in name order. With a fixed four-digit prefix that is
 *     the numeric order; the comparison is by code unit, which is what bash's
 *     glob gives under the C locale and, for these names (ASCII, lower case,
 *     digits and underscores), under every locale.
 *   * The version is the prefix read as a base-10 integer (`10#0042` = 42).
 *   * The checksum is the lower-case hex SHA-256 of the file's BYTES, exactly
 *     `shasum -a 256 | cut -c1-64`. The bytes, not a decoded string: a BOM or a
 *     CRLF is part of the checksum.
 *   * A file is applied WITHOUT the wrapping transaction when one of its first
 *     20 lines starts with `-- no-transaction:`.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The glob `[0-9][0-9][0-9][0-9]_*.sql`, as a regular expression. */
export const MIGRATION_FILE = /^[0-9]{4}_.*\.sql$/;

/** The marker, and the number of leading lines it is looked for in. */
export const NO_TRANSACTION_MARKER = /^-- no-transaction:/;
export const NO_TRANSACTION_LINES = 20;

export type MigrationFile = {
  /** The file name, e.g. `0042_fuel.sql` — also what `schema_migrations.name` holds. */
  readonly name: string;
  /** The prefix as an integer. */
  readonly version: number;
  /** Lower-case hex SHA-256 of the bytes. */
  readonly checksum: string;
  /** Applied without `begin; … commit;` (see the header). */
  readonly noTransaction: boolean;
  /** The bytes, as read. */
  readonly bytes: Buffer;
  /** A version the baseline stands for (db/baseline/ledger.tsv): no bytes of its own, applied only as part of the baseline. */
  readonly baseline?: boolean;
};

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `10#${name%%_*}` — the four leading digits as a decimal integer. */
export function versionOf(name: string): number {
  return Number.parseInt(name.slice(0, 4), 10);
}

/**
 * Whether a line among the first 20 STARTS with the marker. awk's records are
 * split on `\n`; a CRLF file keeps its `\r` at the end of the line, which does
 * not affect a match at the start of it.
 */
export function hasNoTransactionMarker(bytes: Buffer): boolean {
  const lines = bytes.toString("latin1").split("\n");
  for (let i = 0; i < Math.min(NO_TRANSACTION_LINES, lines.length); i += 1) {
    if (NO_TRANSACTION_MARKER.test(lines[i] ?? "")) return true;
  }
  return false;
}

/** Code-unit order, which for these names is bash's glob order. */
export function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function describeFile(name: string, bytes: Buffer): MigrationFile {
  return { name, version: versionOf(name), checksum: sha256Hex(bytes), noTransaction: hasNoTransactionMarker(bytes), bytes };
}

/** Every migration in `dir`, in apply order. A missing directory throws: an image without its files is not a database. */
export function readMigrations(dir: string): MigrationFile[] {
  const names = readdirSync(dir).filter((n) => MIGRATION_FILE.test(n)).sort(byName);
  return names.map((n) => describeFile(n, readFileSync(join(dir, n))));
}
