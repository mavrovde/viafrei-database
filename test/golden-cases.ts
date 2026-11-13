/**
 * The migrate cases whose psql traffic is RECORDED: existing ledgers hold the
 * checksums these bytes produce, so the bytes are the contract.
 * test/golden/migrate/<case>.json holds, per case, every psql call — argv after
 * the connection flags, and stdin — plus the exit code and the last stderr
 * line. test/golden.test.ts runs migrate over the same files and the same
 * planted failures and asserts the same calls, byte for byte.
 */
export type GoldenCase = {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  /** psql calls (1-based, counted over the whole run) that fail with SQLSTATE 55P03. */
  readonly failCalls: readonly number[];
  readonly attempts: number;
};

export const WRAPPED = "create table a(id int);\n";
export const NO_TX = "-- no-transaction: create index concurrently cannot run in a transaction\ncreate index concurrently if not exists a_id on a(id);\n";
export const TRAILING_COMMENT = "create table c(id int);\n-- a trailing comment";
export const CRLF = "create table d(id int);\r\n-- rollback: drop table d;\r\n";

export const GOLDEN_CASES: readonly GoldenCase[] = [
  { name: "wrapped", files: { "0001_a.sql": WRAPPED }, failCalls: [], attempts: 1 },
  { name: "no-transaction", files: { "0001_a.sql": WRAPPED, "0002_b.sql": NO_TX }, failCalls: [], attempts: 1 },
  { name: "trailing-comment", files: { "0001_c.sql": TRAILING_COMMENT }, failCalls: [], attempts: 1 },
  { name: "crlf", files: { "0001_d.sql": CRLF }, failCalls: [], attempts: 1 },
  // Calls 1 and 2 create and read the ledger; call 3 is the first apply.
  { name: "lock-retry", files: { "0001_a.sql": WRAPPED }, failCalls: [3], attempts: 2 },
  { name: "lock-exhausted", files: { "0001_a.sql": WRAPPED, "0002_b.sql": NO_TX }, failCalls: [4, 5, 6], attempts: 3 },
];

export type GoldenCall = { readonly args: readonly string[]; readonly stdin: string };
export type Golden = { readonly exitCode: number; readonly lastStderr: string; readonly calls: readonly GoldenCall[] };
