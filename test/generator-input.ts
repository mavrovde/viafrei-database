/**
 * What the hand-run generators (test/acl.ts, test/checks.ts, test/policies.ts,
 * test/tables.ts) take from the command line and the environment, checked
 * before it is used: a database is a `test_` database on this machine, and a
 * file is one inside this repository. A generator lifts guards inside a
 * transaction it rolls back, but it still runs as whoever the URL names, so it
 * is never pointed at a database that is not a throwaway one.
 *
 * Also the one string order the generators and their tests share: code-unit
 * order, what Array.prototype.sort() does with no compare function.
 */
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type pg from "pg";

export const REPO_ROOT = join(import.meta.dirname, "..");

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Code-unit order: the order of a sort() without a compare function, and of a C-collated `order by`. */
export function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * The client configuration of a `postgres://`/`postgresql://` URL, or an
 * error: the host must be loopback and the database's name must start with
 * `test_`. The connection is built from the checked parts, never from the
 * string itself, so no parameter the URL carries beyond them reaches pg.
 */
export function testDatabase(arg: string | undefined): pg.ClientConfig {
  if (arg === undefined || arg === "") throw new Error("a database URL is required: postgresql://<user>@localhost/test_<name>");
  let u: URL;
  try {
    u = new URL(arg);
  } catch {
    throw new Error("the database URL does not parse");
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") throw new Error(`the database URL must be postgres:// or postgresql://, not ${u.protocol}`);
  if (!LOOPBACK.has(u.hostname)) throw new Error(`the database host must be loopback (localhost, 127.0.0.1, ::1), not '${u.hostname}'`);
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!/^test_[A-Za-z0-9_]+$/.test(database)) throw new Error(`the database must be a test_ database, not '${database}'`);
  const config: pg.ClientConfig = { host: u.hostname.replace(/^\[(.*)\]$/, "$1"), database };
  if (u.port !== "") config.port = Number(u.port);
  if (u.username !== "") config.user = decodeURIComponent(u.username);
  if (u.password !== "") config.password = decodeURIComponent(u.password);
  return config;
}

/** `p` resolved against the repository root, or an error when it leaves it. */
export function repoFile(p: string, root: string = REPO_ROOT): string {
  const full = resolve(root, p);
  const rel = relative(root, full);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`'${p}' is not a file inside the repository`);
  return full;
}
