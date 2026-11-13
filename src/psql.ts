/**
 * The one executor of migration SQL: `psql`, with fixed flags and the script on stdin.
 *
 * Why psql and not the `pg` driver: migrations may use `\gexec`, a psql
 * meta-command, and the `-- no-transaction:` files hold
 * `create index concurrently`, which a multi-statement simple query would run
 * inside an implicit transaction and PostgreSQL would refuse. psql splits the
 * script into statements and sends each one alone, so these files are handed to
 * psql as they are: `psql <url> -v ON_ERROR_STOP=1 -q -X -v VERBOSITY=verbose -f -`,
 * script on stdin.
 *
 * THE PASSWORD NEVER REACHES psql's ARGV: `ps`
 * prints every argument to every user of the machine. The password is taken out
 * of the URL by libpq's own URI rules and handed over in `PGPASSWORD`. The
 * split: the authority ends at the first `/` after `://`, the userinfo ends at
 * the LAST `@` inside it, and the password is percent-decoded because libpq
 * decodes a URI's password while PGPASSWORD is taken literally. A URL without a
 * password is left untouched and PGPASSWORD is not set.
 */
import { spawn } from "node:child_process";

export type SplitUrl = { readonly url: string; readonly password: string | null };

export function splitPassword(url: string): SplitUrl {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd === -1) return { url, password: null };
  const scheme = url.slice(0, schemeEnd);
  const afterScheme = url.slice(schemeEnd + 3);
  const slash = afterScheme.indexOf("/");
  const authority = slash === -1 ? afterScheme : afterScheme.slice(0, slash);
  const rest = afterScheme.slice(authority.length);
  const at = authority.lastIndexOf("@");
  if (at === -1) return { url, password: null };
  const userinfo = authority.slice(0, at);
  const hostport = authority.slice(at + 1);
  const colon = userinfo.indexOf(":");
  // `*:?*` in the shell's case: a colon followed by at least one character.
  if (colon === -1 || colon === userinfo.length - 1) return { url, password: null };
  const encoded = userinfo.slice(colon + 1);
  return { url: `${scheme}://${userinfo.slice(0, colon)}@${hostport}${rest}`, password: percentDecode(encoded) };
}

/** libpq's percent-decoding: `%HH` becomes the byte, everything else is literal. Bytes are reassembled as UTF-8. */
export function percentDecode(text: string): string {
  if (!text.includes("%")) return text;
  const out: number[] = [];
  const raw = Buffer.from(text, "utf8");
  for (let i = 0; i < raw.length; i += 1) {
    const b = raw[i] ?? 0;
    if (b === 0x25 && i + 2 < raw.length && /^[0-9a-fA-F]{2}$/.test(String.fromCharCode(raw[i + 1] ?? 0, raw[i + 2] ?? 0))) {
      out.push(Number.parseInt(String.fromCharCode(raw[i + 1] ?? 0, raw[i + 2] ?? 0), 16));
      i += 2;
    } else {
      out.push(b);
    }
  }
  return Buffer.from(out).toString("utf8");
}

export type PsqlResult = { readonly code: number; readonly stdout: string; readonly stderr: string };

/** Runs one psql invocation with `script` on stdin and the given extra arguments. */
export type PsqlRunner = (script: string | Buffer, extraArgs?: readonly string[]) => Promise<PsqlResult>;

/** The fixed flags of every invocation. */
export const PSQL_FLAGS = ["-v", "ON_ERROR_STOP=1", "-q", "-X"] as const;

export type PsqlOptions = {
  readonly databaseUrl: string;
  /** The binary; `VF_DB_PSQL`, default `psql`. */
  readonly bin?: string;
  /** The environment the child inherits; the password is ADDED to a copy, never to the caller's. */
  readonly env?: NodeJS.ProcessEnv;
};

/** The argv and environment of one call — exported so a test can assert the password is in neither argv nor the log. */
export function psqlInvocation(o: PsqlOptions, extraArgs: readonly string[]): { bin: string; args: string[]; env: NodeJS.ProcessEnv } {
  const { url, password } = splitPassword(o.databaseUrl);
  const env: NodeJS.ProcessEnv = { ...(o.env ?? process.env) };
  // Only the password taken out of THIS url is forwarded; one the caller's
  // environment happened to carry is dropped.
  delete env["PGPASSWORD"];
  if (password !== null) env["PGPASSWORD"] = password;
  return { bin: o.bin ?? "psql", args: [url, ...PSQL_FLAGS, ...extraArgs], env };
}

export function psqlRunner(o: PsqlOptions): PsqlRunner {
  return (script, extraArgs = []) =>
    new Promise((resolve) => {
      const call = psqlInvocation(o, extraArgs);
      const child = spawn(call.bin, call.args, { env: call.env, stdio: ["pipe", "pipe", "pipe"] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on("data", (b: Buffer) => out.push(b));
      child.stderr.on("data", (b: Buffer) => err.push(b));
      child.on("error", (e) => resolve({ code: 127, stdout: "", stderr: `psql could not be started (${call.bin}): ${e.message}\n` }));
      child.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }));
      child.stdin.on("error", () => undefined);
      child.stdin.end(script);
    });
}
