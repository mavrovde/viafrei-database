/**
 * Configuration from the environment. Every key is listed here and nowhere
 * else; a value that does not parse stops the process at boot, naming the key
 * and never its value.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository (or image) root: this file lives one level below it, in src/ or dist/. */
export const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type Config = {
  readonly databaseUrl: string;
  readonly migrationsDir: string;
  readonly baselineDir: string;
  readonly rolesSqlDir: string;
  /** The mounted Secret directory with one password file per role; null = the role step is skipped. */
  readonly roleSecretDir: string | null;
  readonly psqlBin: string;
  readonly lockAttempts: number;
  readonly lockPauseS: number;
  readonly partitionDays: number;
  readonly readyPort: number;
  readonly httpPort: number;
  readonly bind: string;
  /** The interface's host name (for example db.example.test); null = the interface port is not opened. */
  readonly interfaceHost: string | null;
  readonly allowCidr: string;
  readonly trustedProxyCidr: string;
  readonly ownerTokenSha256: string | null;
  readonly sessionSecret: string | null;
  readonly recheckS: number;
  readonly partitionsEveryH: number;
};

function int(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new ConfigError(`${key} must be a whole number`);
  const n = Number(raw.trim());
  if (n < min || n > max) throw new ConfigError(`${key} must be between ${String(min)} and ${String(max)}`);
  return n;
}

const opt = (env: NodeJS.ProcessEnv, key: string): string | null => {
  const v = env[key]?.trim();
  return v === undefined || v === "" ? null : v;
};

/** Where the image's schema lives; read without a database (the `version` verb). */
export function schemaDirs(env: NodeJS.ProcessEnv = process.env, root: string = APP_ROOT): { migrationsDir: string; baselineDir: string } {
  return {
    migrationsDir: opt(env, "VF_DB_MIGRATIONS_DIR") ?? join(root, "db", "migrations"),
    baselineDir: opt(env, "VF_DB_BASELINE_DIR") ?? join(root, "db", "baseline"),
  };
}

/** `serve` retries a lock timeout (4 × 20 s); a CLI run makes one attempt. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, mode: "serve" | "cli" = "cli"): Config {
  const databaseUrl = opt(env, "DATABASE_URL");
  if (databaseUrl === null) throw new ConfigError("DATABASE_URL not set");
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) throw new ConfigError("DATABASE_URL must be a postgresql:// URL");
  const ownerTokenSha256 = opt(env, "DB_OWNER_TOKEN_SHA256");
  if (ownerTokenSha256 !== null && !/^[0-9a-f]{64}$/.test(ownerTokenSha256)) throw new ConfigError("DB_OWNER_TOKEN_SHA256 must be 64 lower-case hex characters");
  const sessionSecret = opt(env, "DB_SESSION_SECRET");
  if (sessionSecret !== null && sessionSecret.length < 32) throw new ConfigError("DB_SESSION_SECRET must be at least 32 characters");
  if ((ownerTokenSha256 === null) !== (sessionSecret === null)) throw new ConfigError("DB_OWNER_TOKEN_SHA256 and DB_SESSION_SECRET are set together or not at all");
  const interfaceHost = opt(env, "DB_HOST");
  if (interfaceHost !== null && !/^[a-z0-9.-]+$/.test(interfaceHost.toLowerCase())) throw new ConfigError("DB_HOST must be a host name");
  const readyPort = int(env, "VF_DB_READY_PORT", 8080, 1, 65535);
  const httpPort = int(env, "VF_DB_HTTP_PORT", 8090, 1, 65535);
  // One port for both would route the readiness answers through the edge, or the interface past it.
  if (readyPort === httpPort) throw new ConfigError("VF_DB_READY_PORT and VF_DB_HTTP_PORT must differ");
  return {
    databaseUrl,
    ...schemaDirs(env),
    rolesSqlDir: opt(env, "VF_DB_ROLES_SQL_DIR") ?? join(APP_ROOT, "db", "roles"),
    roleSecretDir: opt(env, "VF_DB_ROLE_DIR"),
    psqlBin: opt(env, "VF_DB_PSQL") ?? "psql",
    lockAttempts: int(env, "DB_MIGRATE_LOCK_ATTEMPTS", mode === "serve" ? 4 : 1, 1, 100),
    lockPauseS: int(env, "DB_MIGRATE_LOCK_PAUSE_S", 20, 0, 3600),
    partitionDays: int(env, "VF_DB_PARTITION_DAYS", mode === "serve" ? 30 : 7, 0, 400),
    readyPort,
    httpPort,
    bind: opt(env, "VF_DB_BIND") ?? "0.0.0.0",
    interfaceHost: interfaceHost?.toLowerCase() ?? null,
    allowCidr: opt(env, "DB_ALLOW_CIDR") ?? "",
    trustedProxyCidr: opt(env, "DB_TRUSTED_PROXY_CIDR") ?? "",
    ownerTokenSha256,
    sessionSecret,
    recheckS: int(env, "VF_DB_RECHECK_S", 30, 5, 3600),
    partitionsEveryH: int(env, "VF_DB_PARTITIONS_EVERY_H", 24, 1, 168),
  };
}
