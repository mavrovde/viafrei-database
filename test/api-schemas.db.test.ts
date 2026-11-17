/**
 * viafrei-api's two schemas (#29), held against a database migrated to head:
 *
 *   contract (0307)  32 views in the API's contract 0.2 shape, column for
 *                    column (test/api/columns.tsv, read off the API's own
 *                    DDL); contract_info states 0.2; 0312 maps the
 *                    others onto the platform's tables (contract-mapping.db.test.ts)
 *                    and appends the licence envelope (test/api/envelope.tsv); api_reader reads them and nothing
 *                    else;
 *   access (0308)    the access store as the API's four steps left it: its
 *                    tables, checks, the append-only audit, the two prune
 *                    functions and their 30-day floor, api_access's grants,
 *                    schema_version 1-3.
 *
 * The roles' attributes, settings and the platform-wide ACL table are held by
 * roles-grants.db.test.ts like every service role's; their passwords by
 * consumer.db.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { DomainDb, refusal } from "./domain-db.js";
import { REPO } from "./helpers.js";

const db = new DomainDb(process.env["TEST_DATABASE_URL"] ?? "", "api");

beforeAll(async () => {
  await db.make([]);
});
afterAll(async () => {
  await db.drop();
});

/** test/api/columns.tsv: relation, position, column, type. */
function expectedColumns(): string[] {
  return readFileSync(join(REPO, "test", "api", "columns.tsv"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"));
}

const CONTRACT_VIEWS = [...new Set(expectedColumns().filter((l) => l.startsWith("contract.")).map((l) => l.split("\t")[0] ?? ""))];
const ACCESS_TABLES = [...new Set(expectedColumns().filter((l) => l.startsWith("access.")).map((l) => l.split("\t")[0] ?? ""))];

/** Runs fn as one role (SET ROLE, so its privileges and not its settings), in a transaction that is rolled back. */
async function as<R>(role: string, fn: (c: pg.PoolClient) => Promise<R>): Promise<R> {
  const c = await db.pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    return await fn(c);
  } finally {
    await c.query("rollback");
    c.release();
  }
}

describe("the shape: the API's own DDL, column for column", () => {
  it("every column of schemas contract and access is the one the API's DDL built, in its position and type, then the envelope 0312 appends, and no other", async () => {
    const r = await db.pool.query<{ l: string }>(
      `select n.nspname || '.' || c.relname || E'\\t' || a.attnum || E'\\t' || a.attname || E'\\t' || format_type(a.atttypid, a.atttypmod) as l
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        where n.nspname in ('contract', 'access') and c.relkind in ('r', 'p', 'v', 'm') and not c.relispartition
        order by n.nspname || '.' || c.relname, a.attnum`,
    );
    const want = expectedColumns();
    expect(want).toHaveLength(489);
    const envelope = readFileSync(join(REPO, "test", "api", "envelope.tsv"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.startsWith("#"));
    expect(envelope).toHaveLength(128);
    const key = (l: string): [string, number] => [l.split("\t")[0] ?? "", Number(l.split("\t")[1])];
    const merged = [...want, ...envelope].sort((a, b) => key(a)[0].localeCompare(key(b)[0]) || key(a)[1] - key(b)[1]);
    expect(r.rows.map((x) => x.l)).toEqual(merged);
    // The API's own columns come first in every view: the envelope only appends.
    for (const e of envelope) {
      const [rel, pos] = key(e);
      expect(Math.max(...want.filter((w) => key(w)[0] === rel).map((w) => key(w)[1]))).toBeLessThan(pos);
    }
  });

  it("every constraint and index of access is the one the API's DDL built, by name and definition, and no other", async () => {
    const want = readFileSync(join(REPO, "test", "api", "access-constraints.tsv"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.startsWith("#"));
    const con = await db.pool.query<{ l: string }>(
      `select 'constraint' || E'\\t' || conrelid::regclass::text || E'\\t' || conname || E'\\t' || pg_get_constraintdef(oid) as l
         from pg_constraint where connamespace = 'access'::regnamespace order by conrelid::regclass::text, conname`,
    );
    const idx = await db.pool.query<{ l: string }>(
      `select 'index' || E'\\t' || pg_get_indexdef(i.indexrelid) as l from pg_index i join pg_class c on c.oid = i.indrelid
        where c.relnamespace = 'access'::regnamespace order by 1`,
    );
    expect(want).toHaveLength(55);
    expect([...con.rows, ...idx.rows].map((x) => x.l).sort()).toEqual([...want].sort());
    // A view has none: the contract carries no constraint of the stub's tables.
    expect((await db.pool.query("select 1 from pg_constraint where connamespace = 'contract'::regnamespace")).rows).toEqual([]);
  });

  it("contract holds views only, 44 of them; access holds its 8 tables, and neither holds anything else", async () => {
    const r = await db.pool.query<{ k: string; n: string }>(
      `select c.relkind::text as k, n.nspname || '.' || c.relname as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('contract', 'access') and c.relkind in ('r', 'p', 'v', 'm', 'f') order by 2`,
    );
    expect(CONTRACT_VIEWS).toHaveLength(44);
    expect(r.rows.filter((x) => x.n.startsWith("contract.")).map((x) => `${x.k} ${x.n}`)).toEqual([...CONTRACT_VIEWS].sort().map((v) => `v ${v}`));
    expect(ACCESS_TABLES).toHaveLength(8);
    expect(r.rows.filter((x) => x.n.startsWith("access.")).map((x) => `${x.k} ${x.n}`)).toEqual([...ACCESS_TABLES].sort().map((t) => `r ${t}`));
  });
});

describe("contract (0307)", () => {
  it("contract_info states version 0.3, once, as the API's readiness reads it", async () => {
    const r = await as("api_reader", (c) =>
      c.query<{ v: string; at: string }>("select contract_version as v, published_at::text as at from contract.contract_info order by published_at desc"),
    );
    expect(r.rows).toEqual([{ v: "0.3", at: "2026-11-16 00:00:00+00" }]);
  });

  it("on a database with no platform rows, only the views over the reference and register rows the migrations load publish anything", async () => {
    const counts: Record<string, number> = {};
    for (const v of CONTRACT_VIEWS.filter((x) => x !== "contract.contract_info")) {
      counts[v] = (await db.pool.query<{ n: number }>(`select count(*)::int as n from ${v}`)).rows[0]?.n ?? -1;
    }
    expect(Object.keys(counts)).toHaveLength(43);
    expect(Object.keys(counts).filter((v) => counts[v] !== 0).sort()).toEqual([
      "contract.admin_region",
      "contract.fuel_product",
      "contract.licence",
      "contract.message_coverage",
      "contract.publisher",
      "contract.rule_statement",
      "contract.rule_topic",
      "contract.source",
      "contract.source_note",
      "contract.terms",
    ]);
    // The register's sources alone: one per register row, each with its publisher and a licence row.
    expect([counts["contract.source"], counts["contract.publisher"], counts["contract.rule_statement"], counts["contract.message_coverage"]]).toEqual([277, 277, 74, 19]);
  });

  it("api_reader reads every contract view and writes none", async () => {
    const r = await db.pool.query<{ v: string; sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
      `select n.nspname || '.' || c.relname as v, has_table_privilege('api_reader', c.oid, 'SELECT') as sel, has_table_privilege('api_reader', c.oid, 'INSERT') as ins,
              has_table_privilege('api_reader', c.oid, 'UPDATE') as upd, has_table_privilege('api_reader', c.oid, 'DELETE') as del
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'contract' order by 1`,
    );
    expect(r.rows).toHaveLength(44);
    expect(r.rows.filter((x) => !x.sel || x.ins || x.upd || x.del)).toEqual([]);
  });

  it("api_reader reads no relation outside contract, uses no schema but contract and public, creates nothing, and owns nothing", async () => {
    const rel = await db.pool.query<{ n: string }>(
      `select n.nspname || '.' || c.relname as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
        cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
        where n.nspname <> 'contract' and n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema' and c.relkind in ('r', 'p', 'v', 'm', 'f')
          and c.oid not in (select objid from pg_depend where deptype = 'e') and has_table_privilege('api_reader', c.oid, p)`,
    );
    expect(rel.rows).toEqual([]);
    const sch = await db.pool.query<{ s: string }>(
      `select nspname || ' ' || p as s from pg_namespace cross join unnest(array['USAGE', 'CREATE']) p
        where nspname not like 'pg\\_%' and nspname <> 'information_schema' and has_schema_privilege('api_reader', oid, p) order by 1`,
    );
    expect(sch.rows.map((x) => x.s)).toEqual(["contract USAGE", "public USAGE"]);
    const owns = await db.pool.query("select 1 from pg_class where relowner = 'api_reader'::regrole union all select 1 from pg_namespace where nspowner = 'api_reader'::regrole");
    expect(owns.rows).toEqual([]);
  });

  it("as api_reader, a contract view is read and a write is refused", async () => {
    expect((await as("api_reader", (c) => c.query("select contract_version from contract.contract_info"))).rows).toHaveLength(1);
    expect(await refusal(as("api_reader", (c) => c.query("select 1 from public.schema_migrations limit 1")))).toMatchObject({ code: "42501" });
    expect(await refusal(as("api_reader", (c) => c.query("select 1 from access.plan")))).toMatchObject({ code: "42501" });
    expect(await refusal(as("api_reader", (c) => c.query("create table contract.x (a int)")))).toMatchObject({ code: "42501" });
  });
});

describe("access (0308)", () => {
  it("api_access holds exactly the store's grants, and PUBLIC none of the store", async () => {
    const r = await db.pool.query<{ l: string }>(
      `select coalesce(g.rolname, 'PUBLIC') || ' ' || x.kind || ' ' || x.obj || ' ' || string_agg(x.privilege_type, ',' order by x.privilege_type) as l
         from (select 'relation' as kind, c.relname as obj, c.relowner as owner, a.* from pg_class c cross join lateral aclexplode(c.relacl) a
                where c.relnamespace = 'access'::regnamespace
               union all select 'schema', s.nspname, s.nspowner, a.* from pg_namespace s cross join lateral aclexplode(s.nspacl) a where s.nspname = 'access'
               union all select 'function', p.proname, p.proowner, a.* from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.pronamespace = 'access'::regnamespace) x
         left join pg_roles g on g.oid = x.grantee
        where x.grantee <> x.owner group by g.rolname, x.kind, x.obj order by 1`,
    );
    expect(r.rows.map((x) => x.l)).toEqual([
      "api_access function prune_audit EXECUTE",
      "api_access function prune_usage EXECUTE",
      "api_access relation api_key INSERT,SELECT,UPDATE",
      "api_access relation audit INSERT,SELECT",
      "api_access relation console_enrolment DELETE,INSERT,SELECT,UPDATE",
      "api_access relation console_passkey DELETE,INSERT,SELECT,UPDATE",
      "api_access relation plan INSERT,SELECT,UPDATE",
      "api_access relation schema_version SELECT",
      "api_access relation terms_acceptance INSERT,SELECT",
      "api_access relation usage INSERT,SELECT,UPDATE",
      "api_access schema access USAGE",
    ]);
  });

  it("api_access holds nothing outside access, and no other service role holds anything in access or contract", async () => {
    const out = await db.pool.query<{ n: string }>(
      `select n.nspname || '.' || c.relname as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
        cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
        where n.nspname <> 'access' and n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema' and c.relkind in ('r', 'p', 'v', 'm', 'f')
          and c.oid not in (select objid from pg_depend where deptype = 'e') and has_table_privilege('api_access', c.oid, p)`,
    );
    expect(out.rows).toEqual([]);
    const others = await db.pool.query<{ l: string }>(
      `select r.rolname || ' ' || n.nspname as l from pg_roles r cross join pg_namespace n
        where r.rolname like 'viafrei\\_%' and n.nspname in ('access', 'contract') and has_schema_privilege(r.oid, n.oid, 'USAGE')`,
    );
    expect(others.rows).toEqual([]);
  });

  it("holds the store's versions 1-3, which the API reads", async () => {
    const r = await as("api_access", (c) => c.query<{ v: number }>("select version as v from access.schema_version order by 1"));
    expect(r.rows.map((x) => x.v)).toEqual([1, 2, 3]);
  });

  it("as api_access: a plan, a key (public by default, made own), an acceptance, usage and an audit row are written; the audit is append-only", async () => {
    await as("api_access", async (c) => {
      await c.query(
        "insert into access.plan values ('free', 'consumer', 'standard', '{read}', '{all}', now(), 10, 20, 1000, 20000)",
      );
      await c.query(
        "insert into access.api_key (key_id, environment, plan_name, label, contact, mac, issued_at, expires_at, changed_at) values ('Abc123XYZ0', 'live', 'free', 'l', 'c', decode(repeat('00', 32), 'hex'), now(), now() + interval '1 year', now())",
      );
      expect((await c.query<{ a: string }>("select audience as a from access.api_key where key_id = 'Abc123XYZ0'")).rows).toEqual([{ a: "public" }]);
      await c.query("update access.api_key set audience = 'own' where key_id = 'Abc123XYZ0'");
      await c.query("insert into access.terms_acceptance values ('Abc123XYZ0', 'sid', 'v1', now())");
      await c.query("insert into access.usage values ('Abc123XYZ0', date_trunc('hour', now()), 'getRoad', 1, 0, 0, 0, 0, 0, 3)");
      await c.query("insert into access.audit (at, action, key_id, actor) values (now(), 'issue', 'Abc123XYZ0', 'owner')");
      await c.query("savepoint s");
      await expect(c.query("update access.audit set actor = 'x'")).rejects.toMatchObject({ code: "42501" });
      await c.query("rollback to savepoint s");
      await expect(c.query("delete from access.audit")).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("refuses a malformed key id, an unknown audit action or key audience, a rate out of bounds, a negative count and a half-set rotation", async () => {
    const plan = "insert into access.plan values ('p', 'consumer', 'standard', '{}', '{}', now(), 1, 1, 0, 0)";
    const key = (id: string, extra = ""): string =>
      `insert into access.api_key (key_id, environment, plan_name, label, contact, mac, issued_at, expires_at, changed_at${extra === "" ? "" : ", previous_mac"}) values ('${id}', 'live', 'p', 'l', 'c', decode(repeat('00', 32), 'hex'), now(), now(), now()${extra})`;
    const tryAll = async (sql: string): Promise<string | undefined> =>
      (await refusal(db.pool.query(`do $$ begin ${plan}; ${sql}; raise exception 'accepted'; end $$`)))?.message;
    expect(await tryAll(key("short"))).toMatch(/api_key_key_id_check/);
    expect(await tryAll(key("Abc123XYZ0", ", decode(repeat('00', 32), 'hex')"))).toMatch(/api_key_check\b/);
    expect(await tryAll("insert into access.audit (at, action, actor) values (now(), 'delete_everything', 'x')")).toMatch(/audit_action_check/);
    expect(await tryAll(`${key("Abc123XYZ0")}; update access.api_key set audience = 'partner'`)).toMatch(/api_key_audience_check/);
    expect(await tryAll("update access.plan set rate_per_second = 0")).toMatch(/plan_rate_per_second_check/);
    expect(await tryAll(`${key("Abc123XYZ0")}; insert into access.usage values ('Abc123XYZ0', now(), 'op', -1, 0, 0, 0, 0, 0, 0)`)).toMatch(/usage_requests_check/);
    // The same statements, well-formed, are accepted (the planted 'accepted' is the error that comes back).
    expect(await tryAll(`${key("Abc123XYZ0")}; insert into access.audit (at, action, actor) values (now(), 'console_sign_in', 'x')`)).toBe("accepted");
  });

  it("the prune functions keep every row younger than 30 days, remove older ones, and only api_access (or the owner) may call them", async () => {
    await as("api_access", async (c) => {
      await c.query("savepoint s");
      await expect(c.query("select access.prune_audit(now() - interval '29 days')")).rejects.toThrow(/younger than 30 days are kept/);
      await c.query("rollback to savepoint s");
      await expect(c.query("select access.prune_usage(29)")).rejects.toThrow(/younger than 30 days are kept/);
      await c.query("rollback to savepoint s");
      await c.query("insert into access.audit (at, action, actor) values (now() - interval '40 days', 'issue', 'x'), (now() - interval '5 days', 'issue', 'x')");
      expect((await c.query<{ n: string }>("select access.prune_audit(now() - interval '30 days') as n")).rows[0]?.n).toBe("1");
      expect((await c.query<{ n: string }>("select count(*) as n from access.audit")).rows[0]?.n).toBe("1");
      expect((await c.query<{ n: string }>("select access.prune_usage(30) as n")).rows[0]?.n).toBe("0");
    });
    expect(await refusal(as("viafrei_mcp", (c) => c.query("select access.prune_audit(now() - interval '90 days')")))).toMatchObject({ code: "42501" });
    const pub = await db.pool.query<{ ok: boolean }>(
      "select bool_or(has_function_privilege('public', p.oid, 'EXECUTE')) as ok from pg_proc p where p.pronamespace = 'access'::regnamespace",
    );
    expect(pub.rows[0]?.ok).toBe(false);
  });
});

describe("a pre-existing API role is taken only as these migrations would make it", () => {
  /** Runs the CLI with these variables set, its output kept off the test's own. */
  async function cli(argv: string[], env: Record<string, string>): Promise<{ code: number; out: string }> {
    const saved = { ...process.env };
    const out: string[] = [];
    const o = vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true));
    const e = vi.spyOn(process.stderr, "write").mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true));
    Object.assign(process.env, env);
    try {
      return { code: await main(argv), out: out.join("") };
    } finally {
      o.mockRestore();
      e.mockRestore();
      process.env = saved;
    }
  }

  it("api_reader as a member of another role stops migrate at 0307, and nothing of 0307 stays", async () => {
    const name = `${db.name}_member`;
    const url = new URL(db.url);
    url.pathname = `/${name}`;
    await db.pool.query(`drop database if exists ${name} with (force)`);
    await db.pool.query(`create database ${name}`);
    await db.pool.query("create role vf_test_api_group nologin");
    try {
      await db.pool.query("grant vf_test_api_group to api_reader");
      const r = await cli(["migrate"], { DATABASE_URL: url.toString() });
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/role api_reader exists with other attributes or a membership this migration does not give it/);
      const c = new pg.Client({ connectionString: url.toString() });
      await c.connect();
      try {
        const left = await c.query<{ head: number; contract: boolean }>(
          "select (select max(version) from public.schema_migrations)::int as head, exists (select from pg_namespace where nspname = 'contract') as contract",
        );
        expect(left.rows[0]).toEqual({ head: 306, contract: false });
      } finally {
        await c.end();
      }
    } finally {
      await db.pool.query("revoke vf_test_api_group from api_reader");
      await db.pool.query("drop role vf_test_api_group");
      await db.pool.query(`drop database if exists ${name} with (force)`);
    }
  });
});
