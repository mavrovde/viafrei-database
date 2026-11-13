#!/usr/bin/env node
/**
 * viafrei-db — the service and its CLI, one entry point, the same verbs as the
 * interface:
 *
 *   serve                      (default) migrate, partitions ensure, role passwords, then serve
 *   migrate [--dry-run]        apply pending migrations under the advisory lock
 *   partitions ensure [--days N]   ensure_daily_partitions(N) (default 7)
 *   analyze <table>            ANALYZE one table
 *   check                      read-only verdict: head, checksums, partition window
 *   status                     read-only diagnostics as JSON
 *   head                       image head against the ledger; exit 0 only when READY
 *   lint [--root DIR]          the migration lint over a checkout
 *   export-migrations          a tar of db/ (baseline, migrations, roles) on stdout
 *   version                    the package version and the image's schema head
 *   ledger-compare <file|->    an exported ledger against the baseline's ledger.tsv (no database)
 *
 * Exit codes: 0 ok, 1 failed, 2 usage or configuration, 75 a lock timeout or
 * another migrate running (retry later), psql's own code for a failed statement.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { APP_ROOT, ConfigError, loadConfig, schemaDirs } from "./config.js";
import { BaselineError, compareLedgerExport, loadSchema } from "./migrations/baseline.js";
import { jsonLogger } from "./log.js";
import { DatabaseService } from "./service.js";
import { partitionDays, DEFAULT_CLI_DAYS } from "./partitions.js";
import { readiness } from "./migrations/plan.js";
import { fsIo, lint } from "./lint/check-migrations.js";
import { AllowListError, createAccessPolicy } from "./server/access.js";
import { interfaceHandler, readinessHandler } from "./server/http.js";

export const USAGE = `usage: viafrei-db [serve | migrate [--dry-run] | partitions ensure [--days N] | analyze <table> | check | status | head | lint [--root DIR] | export-migrations | version | ledger-compare <file|->]`;

const print = (l: string): void => void process.stdout.write(`${l}\n`);
const printErr = (l: string): void => void process.stderr.write(`${l}\n`);

/** What export-migrations puts in the tar: each of db/baseline, db/migrations and db/roles that exists. */
export function exportPaths(root: string): string[] {
  return ["db/baseline", "db/migrations", "db/roles"].filter((p) => existsSync(join(root, p)));
}

/**
 * `viafrei-database <version> schema-head <N>`: the package version and the
 * newest schema version this image carries (the baseline's or a file's). The
 * release workflow compares both with the tag and the tree before it pushes.
 */
export function versionLine(root: string, env: NodeJS.ProcessEnv): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown };
  const dirs = schemaDirs(env, root);
  const schema = loadSchema(dirs.migrationsDir, dirs.baselineDir);
  const head = schema.all.reduce((m, f) => Math.max(m, f.version), 0);
  return `viafrei-database ${typeof pkg.version === "string" ? pkg.version : "?"} schema-head ${String(head)}`;
}

export async function main(argv: readonly string[]): Promise<number> {
  const [verb = "serve", ...rest] = argv;
  try {
    switch (verb) {
      case "help":
      case "--help":
        print(USAGE);
        return 0;
      case "lint": {
        const i = rest.indexOf("--root");
        const root = i >= 0 ? rest[i + 1] : process.env["MIGRATIONS_LINT_ROOT"] ?? APP_ROOT;
        if (root === undefined) return usage("--root needs a directory");
        const r = lint(fsIo(root));
        for (const l of r.lines) print(l);
        return r.exitCode;
      }
      case "version": {
        if (rest.length > 0) return usage("version takes no argument");
        print(versionLine(APP_ROOT, process.env));
        return 0;
      }
      case "ledger-compare": {
        // Read-only: a database's exported ledger against this image's ledger.tsv.
        if (rest.length !== 1 || rest[0] === undefined) return usage("ledger-compare takes one file (or - for stdin)");
        const dirs = schemaDirs(process.env);
        const b = loadSchema(dirs.migrationsDir, dirs.baselineDir).baseline;
        if (b === null) return usage("this image carries no baseline to compare with");
        let text: string;
        try {
          text = readFileSync(rest[0] === "-" ? 0 : rest[0], "utf8");
        } catch (e) {
          printErr(`✗ cannot read the export: ${(e as Error).message}`);
          return 2;
        }
        const r = compareLedgerExport(b, text);
        for (const l of r.lines) (r.exitCode === 0 ? print : printErr)(l);
        return r.exitCode;
      }
      case "export-migrations":
        return await new Promise<number>((resolve) => {
          const t = spawn("tar", ["-c", "-C", APP_ROOT, ...exportPaths(APP_ROOT)], { stdio: ["ignore", "inherit", "inherit"] });
          t.on("error", () => resolve(1));
          t.on("close", (c) => resolve(c ?? 1));
        });
      case "serve":
        return await serve();
      case "migrate":
      case "partitions":
      case "analyze":
      case "check":
      case "status":
      case "head":
        return await oneShot(verb, rest);
      default:
        return usage(`unknown verb '${verb}'`);
    }
  } catch (e) {
    if (e instanceof ConfigError || e instanceof AllowListError || e instanceof BaselineError) {
      printErr(`✗ ${e.message}`);
      return 2;
    }
    throw e;
  }
}

function usage(why: string): number {
  printErr(`✗ ${why}`);
  printErr(USAGE);
  return 2;
}

async function oneShot(verb: string, rest: readonly string[]): Promise<number> {
  // Checked before the config is read, so a usage error never needs a database.
  if (verb === "migrate" && rest.some((a) => a !== "--dry-run")) return usage(`migrate takes only --dry-run`);
  if (verb === "partitions" && rest[0] !== "ensure") return usage("partitions takes one sub-verb: ensure");
  if (verb === "analyze" && rest.length !== 1) return usage("analyze takes exactly one table name");
  if ((verb === "check" || verb === "status" || verb === "head") && rest.length > 0) return usage(`${verb} takes no argument`);
  let days = DEFAULT_CLI_DAYS;
  if (verb === "partitions") {
    const tail = rest.slice(1);
    if (tail.length !== 0 && !(tail.length === 2 && tail[0] === "--days")) return usage("partitions ensure takes only --days N");
    try {
      days = partitionDays(tail[1], DEFAULT_CLI_DAYS);
    } catch (e) {
      return usage((e as Error).message);
    }
  }
  const config = loadConfig(process.env, "cli");
  const svc = new DatabaseService({ config, log: jsonLogger((l) => void process.stderr.write(`${l}\n`)) });
  try {
    if (verb === "status") {
      await svc.refresh();
      print(JSON.stringify({ readiness: readiness(svc.snapshot().schema), imageHead: svc.snapshot().imageHead, diagnostics: await svc.diagnostics() }, null, 2));
      return 0;
    }
    if (verb === "head") {
      await svc.refresh();
      const s = svc.snapshot();
      const r = s.schemaReadiness;
      print(r.ready ? `READY ${String(r.head)}` : `NOT READY: ${r.detail}`);
      if (s.schema !== null && s.schema.ahead.length > 0) print(`note: the ledger holds ${String(s.schema.ahead.length)} version(s) newer than this image`);
      return r.ready ? 0 : 1;
    }
    const rec =
      verb === "migrate"
        ? await svc.migrate("cli", rest.includes("--dry-run"))
        : verb === "partitions"
          ? await svc.ensurePartitions("cli", days)
          : verb === "analyze"
            ? await svc.analyze(rest[0] ?? "", "cli")
            : await svc.check("cli");
    for (const l of rec.lines) (rec.ok ? print : printErr)(l);
    return rec.exitCode;
  } finally {
    await svc.close();
  }
}

async function serve(): Promise<number> {
  const config = loadConfig(process.env, "serve");
  const log = jsonLogger();
  const svc = new DatabaseService({ config, log });
  const ready = http.createServer(readinessHandler(svc));
  await new Promise<void>((r) => ready.listen(config.readyPort, config.bind, r));
  log.info({ port: config.readyPort }, "readiness port listening (/healthz, /ready)");
  let iface: http.Server | null = null;
  if (config.interfaceHost !== null) {
    const policy = createAccessPolicy({ allowCidr: config.allowCidr, trustedProxyCidr: config.trustedProxyCidr, host: config.interfaceHost, warn: log.warn });
    const auth = config.ownerTokenSha256 !== null && config.sessionSecret !== null ? { tokenSha256: config.ownerTokenSha256, sessionSecret: config.sessionSecret } : null;
    iface = http.createServer(interfaceHandler({ svc, policy, auth, log }));
    iface.headersTimeout = 10_000;
    iface.requestTimeout = 30_000;
    await new Promise<void>((r) => iface?.listen(config.httpPort, config.bind, r));
    log.info({ port: config.httpPort, actions: auth !== null }, "interface port listening");
  } else log.info({}, "DB_HOST is not set: no interface port, readiness only");
  svc.schedule();
  void svc.boot();
  return await new Promise<number>((resolve) => {
    const stop = (): void => {
      process.off("SIGTERM", stop);
      process.off("SIGINT", stop);
      log.info({}, "stopping");
      ready.close();
      iface?.close();
      void svc.close().finally(() => resolve(0));
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  });
}

/** True when node was started with this file (resolved through symlinks, as npm's bin links are). */
export function isEntry(argv: readonly string[] = process.argv): boolean {
  const arg = argv[1];
  if (arg === undefined) return false;
  try {
    return realpathSync(arg) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/** Runs main and exits with its code; an unexpected error is printed with its stack and is exit 1. */
export async function entry(argv: readonly string[], exit: (code: number) => void = process.exit.bind(process)): Promise<void> {
  try {
    exit(await main(argv));
  } catch (e) {
    printErr(`✗ ${(e as Error).stack ?? String(e)}`);
    exit(1);
  }
}

// Reached only when node starts this file, which a test never does (it imports it); the entry above is tested.
/* v8 ignore next */
if (isEntry()) void entry(process.argv.slice(2));
