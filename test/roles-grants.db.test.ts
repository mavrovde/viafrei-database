/**
 * The service roles and what each may do, held in both directions against a
 * database migrated to head (#32 roles and grants, #31 the role tests main
 * removed):
 *
 *   catalogue → table   every privilege a viafrei_* role or PUBLIC holds on an
 *                       object of ours is a row of test/acl/expected.tsv;
 *   table → catalogue   every row of it is held;
 *   behaviour           has_*_privilege agrees with the table on every
 *                       relation, column, schema and function of ours, so a
 *                       privilege that arrives another way (a membership, a
 *                       PUBLIC grant, a column grant) is caught too;
 *   consumers           what viafrei's digest, mcp and status say their role
 *                       reads, writes and must never read (test/acl/consumers.tsv);
 *   roles               each role's attributes as the baseline creates it, no
 *                       membership, and its settings (db/roles/settings.sql).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES } from "../src/roles.js";
import { type AclRow, expectedAcl, key, readAcl } from "./acl.js";
import { DomainDb } from "./domain-db.js";
import { REPO } from "./helpers.js";
import { byRole, parseSettings, settingsFile } from "./role-settings.js";

const db = new DomainDb(process.env["TEST_DATABASE_URL"] ?? "", "grants");
let held: AclRow[] = [];

beforeAll(async () => {
  await db.make([]);
  held = await readAcl(db.pool);
});
afterAll(async () => {
  await db.drop();
});

/** The rows of one grantee, catalogue and table, as the keys the other side lacks. */
function both(grantee: string): { notInTable: string[]; notHeld: string[]; rows: number } {
  const want = expectedAcl().filter((r) => r.grantee === grantee).map(key);
  const have = held.filter((r) => r.grantee === grantee).map(key);
  return { notInTable: have.filter((k) => !want.includes(k)), notHeld: want.filter((k) => !have.includes(k)), rows: want.length };
}

/**
 * Every privilege of one role on every object of ours that has_*_privilege
 * reports differently from the table (its own rows, PUBLIC's, and for a
 * function with no ACL at all PostgreSQL's default EXECUTE to PUBLIC).
 */
async function disagreements(role: string): Promise<{ checked: number; wrong: string[] }> {
  const rows = expectedAcl().filter((r) => r.grantee === role || r.grantee === "PUBLIC");
  const granted = new Set<string>();
  for (const r of rows) for (const p of r.privileges.split(",")) granted.add(`${r.kind}\t${r.object}\t${p.replace(/\*$/, "")}`);
  const r = await db.pool.query<{ kind: string; object: string; priv: string; can: boolean; open: boolean }>(
    `with ext as (select objid from pg_depend where deptype = 'e'),
     ours as (select oid, nspname from pg_namespace where nspname not like 'pg\\_%' and nspname <> 'information_schema'),
     rel as (select c.oid, n.nspname || '.' || c.relname as name from pg_class c join ours n on n.oid = c.relnamespace
              where c.relkind in ('r', 'p', 'v', 'm') and not c.relispartition and c.oid not in (select objid from ext))
     select 'relation' as kind, rel.name as object, p as priv, has_table_privilege($1, rel.oid, p) as can, false as open
       from rel cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
     union all
     select 'column', rel.name || '.' || a.attname, p, has_column_privilege($1, rel.oid, a.attnum, p), false
       from rel join pg_attribute a on a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
     union all
     select 'schema', n.nspname, p, has_schema_privilege($1, n.oid, p), false from ours n cross join unnest(array['USAGE', 'CREATE']) p
     union all
     select 'function', n.nspname || '.' || f.proname || '(' || pg_get_function_identity_arguments(f.oid) || ')', 'EXECUTE',
            has_function_privilege($1, f.oid, 'EXECUTE'), f.proacl is null
       from pg_proc f join ours n on n.oid = f.pronamespace where f.oid not in (select objid from ext)`,
    [role],
  );
  const wrong: string[] = [];
  for (const x of r.rows) {
    let want = granted.has(`${x.kind}\t${x.object}\t${x.priv}`) || (x.kind === "function" && x.open);
    // A table-level privilege covers every column of it.
    if (x.kind === "column") {
      const rel = x.object.slice(0, x.object.lastIndexOf("."));
      want ||= granted.has(`relation\t${rel}\t${x.priv}`);
    }
    if (x.can !== want) wrong.push(`${x.can ? "can" : "cannot"} ${x.priv} ${x.kind} ${x.object}`);
  }
  return { checked: r.rows.length, wrong };
}

/** The consumer's own claims for one role: each one judged on the database. */
async function consumer(role: string): Promise<{ claims: number; forbiddenPresent: number; wrong: string[] }> {
  const lines = readFileSync(join(REPO, "test", "acl", "consumers.tsv"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => l.split("\t"))
    .filter((c) => c[0] === role);
  const wrong: string[] = [];
  let forbiddenPresent = 0;
  for (const [, rel = "", what = ""] of lines) {
    const exists = (await db.pool.query<{ t: string | null }>("select to_regclass($1)::text as t", [rel])).rows[0]?.t != null;
    const [verb = "", cols = ""] = what.split(":");
    if (verb === "forbidden") {
      if (!exists) continue;
      forbiddenPresent += 1;
      const can = (await db.pool.query<{ ok: boolean }>("select has_any_column_privilege($1, $2::regclass, 'SELECT') as ok", [role, rel])).rows[0]?.ok;
      if (can !== false) wrong.push(`reads forbidden ${rel}`);
      continue;
    }
    if (!exists) {
      wrong.push(`${what} ${rel}: no such relation`);
      continue;
    }
    if (verb === "select" && cols === "") {
      const ok = (await db.pool.query<{ ok: boolean }>("select has_any_column_privilege($1, $2::regclass, 'SELECT') as ok", [role, rel])).rows[0]?.ok;
      if (ok !== true) wrong.push(`cannot select ${rel}`);
    } else if (verb === "delete") {
      const ok = (await db.pool.query<{ ok: boolean }>("select has_table_privilege($1, $2::regclass, 'DELETE') as ok", [role, rel])).rows[0]?.ok;
      if (ok !== true) wrong.push(`cannot delete ${rel}`);
    } else {
      for (const col of cols.split(",")) {
        const ok = (await db.pool.query<{ ok: boolean }>("select has_column_privilege($1, $2::regclass, $3, $4) as ok", [role, rel, col, verb.toUpperCase()])).rows[0]?.ok;
        if (ok !== true) wrong.push(`cannot ${verb} ${rel}.${col}`);
      }
    }
  }
  return { claims: lines.length, forbiddenPresent, wrong };
}

/** The attributes the baseline creates a role with, and the role as pg_roles holds it, in the same words. */
async function attributes(role: string): Promise<{ baseline: string; held: string }> {
  // The baseline's roles, and viafrei-api's two, which 0307 and 0308 create the same way.
  const sql = ["0293_baseline.sql", "../migrations/0307_contract_read_model.sql", "../migrations/0308_access_store.sql"]
    .map((f) => readFileSync(join(REPO, "db", "baseline", f), "utf8"))
    .join("\n");
  const baseline = new RegExp(`CREATE ROLE ${role} WITH ([A-Z ]+?)(?: CONNECTION LIMIT (\\d+))?;`).exec(sql);
  const r = (
    await db.pool.query<{ s: string }>(
      `select concat_ws(' ', case when rolsuper then 'SUPERUSER' else 'NOSUPERUSER' end, case when rolinherit then 'INHERIT' else 'NOINHERIT' end,
              case when rolcreaterole then 'CREATEROLE' else 'NOCREATEROLE' end, case when rolcreatedb then 'CREATEDB' else 'NOCREATEDB' end,
              case when rolcanlogin then 'LOGIN' else 'NOLOGIN' end, case when rolreplication then 'REPLICATION' else 'NOREPLICATION' end,
              case when rolbypassrls then 'BYPASSRLS' else 'NOBYPASSRLS' end) || case when rolconnlimit >= 0 then ' CONNECTION LIMIT ' || rolconnlimit else '' end as s
         from pg_roles where rolname = $1`,
      [role],
    )
  ).rows[0]?.s;
  return { baseline: baseline === null ? "(no CREATE ROLE in the baseline)" : `${baseline[1] ?? ""}${baseline[2] === undefined ? "" : ` CONNECTION LIMIT ${baseline[2]}`}`, held: r ?? "(no such role)" };
}

async function roleShape(role: string): Promise<void> {
  const a = await attributes(role);
  expect(a.held).toBe(a.baseline);
  const m = await db.pool.query<{ m: string }>("select roleid::regrole::text || ' > ' || member::regrole::text as m from pg_auth_members where roleid = $1::regrole or member = $1::regrole", [role]);
  expect(m.rows).toEqual([]);
  const s = await db.pool.query<{ s: string }>(
    `select lower(split_part(x, '=', 1)) || '=' || substr(x, strpos(x, '=') + 1) as s from pg_db_role_setting d cross join unnest(d.setconfig) x
      where d.setrole = $1::regrole and d.setdatabase = (select oid from pg_database where datname = current_database()) order by 1`,
    [role],
  );
  expect(s.rows.map((x) => x.s)).toEqual(byRole(parseSettings(settingsFile()), "-").get(role) ?? []);
}

describe("the expected-ACL table", () => {
  it("parses, holds each (grantee, kind, object) once, in order, and names only the service roles and PUBLIC", () => {
    const rows = expectedAcl();
    expect(rows.length).toBeGreaterThan(400);
    const ids = rows.map((r) => `${r.grantee}\t${r.kind}\t${r.object}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(ids);
    expect([...new Set(rows.map((r) => r.grantee))].sort()).toEqual(["PUBLIC", ...ROLES.map((x) => x.role)].sort());
  });

  it("is read off the catalogue by the same query the comparison uses: no privilege of ours is left out of it", async () => {
    const all = (await db.pool.query<{ n: number }>(
      `select count(*)::int as n from pg_class c cross join lateral aclexplode(c.relacl) a join pg_roles g on g.oid = a.grantee
        where (g.rolname like 'viafrei\\_%' or g.rolname in ('api_reader', 'api_access')) and c.relnamespace in (select oid from pg_namespace where nspname in ('public', 'control', 'domains', 'ingestor', 'contract', 'access')) and not c.relispartition and c.relkind in ('r', 'p', 'v', 'm')`,
    )).rows[0]?.n ?? 0;
    const read = held.filter((r) => r.kind === "relation" && r.grantee !== "PUBLIC").reduce((s, r) => s + r.privileges.split(",").length, 0);
    expect(read).toBe(all);
  });
});

describe("each grantee: the catalogue and expected.tsv, both directions", () => {
  const check = (g: string): void => {
    const b = both(g);
    expect(b.rows).toBeGreaterThan(0);
    expect({ notInTable: b.notInTable, notHeld: b.notHeld }).toEqual({ notInTable: [], notHeld: [] });
  };
  it("viafrei_digest: every privilege it holds is a row, every row is held", () => check("viafrei_digest"));
  it("viafrei_mcp: every privilege it holds is a row, every row is held", () => check("viafrei_mcp"));
  it("viafrei_status: every privilege it holds is a row, every row is held", () => check("viafrei_status"));
  it("viafrei_ops: every privilege it holds is a row, every row is held", () => check("viafrei_ops"));
  it("viafrei_translate: every privilege it holds is a row, every row is held", () => check("viafrei_translate"));
  it("viafrei_ingestor: every privilege it holds is a row, every row is held", () => check("viafrei_ingestor"));
  it("PUBLIC: every privilege it holds is a row, every row is held", () => check("PUBLIC"));
  it("api_reader: every privilege it holds is a row, every row is held", () => check("api_reader"));
  it("api_access: every privilege it holds is a row, every row is held", () => check("api_access"));
});

describe("each role: what has_*_privilege says it can do is exactly the table", () => {
  const check = async (role: string): Promise<void> => {
    const d = await disagreements(role);
    expect(d.checked).toBeGreaterThan(1000);
    expect(d.wrong).toEqual([]);
  };
  it("viafrei_digest: every relation, column, schema and function of ours", () => check("viafrei_digest"));
  it("viafrei_mcp: every relation, column, schema and function of ours", () => check("viafrei_mcp"));
  it("viafrei_status: every relation, column, schema and function of ours", () => check("viafrei_status"));
  it("viafrei_ops: every relation, column, schema and function of ours", () => check("viafrei_ops"));
  it("viafrei_translate: every relation, column, schema and function of ours", () => check("viafrei_translate"));
  it("viafrei_ingestor: every relation, column, schema and function of ours", () => check("viafrei_ingestor"));
  it("api_reader: every relation, column, schema and function of ours", () => check("api_reader"));
  it("api_access: every relation, column, schema and function of ours", () => check("api_access"));
});

describe("each consumer's own declared list", () => {
  it("viafrei_digest reads every relation digest names and none it forbids", async () => {
    const c = await consumer("viafrei_digest");
    expect(c.claims).toBeGreaterThan(100);
    expect(c.forbiddenPresent).toBeGreaterThan(10);
    expect(c.wrong).toEqual([]);
  });
  it("viafrei_mcp reads, writes and deletes what mcp names and reads none it forbids", async () => {
    const c = await consumer("viafrei_mcp");
    expect(c.claims).toBeGreaterThan(100);
    expect(c.forbiddenPresent).toBeGreaterThan(5);
    expect(c.wrong).toEqual([]);
  });
  it("viafrei_status reads every relation status names", async () => {
    const c = await consumer("viafrei_status");
    expect(c.claims).toBeGreaterThan(40);
    expect(c.wrong).toEqual([]);
  });
});

describe("each role: its attributes, no membership, its settings", () => {
  it("viafrei_digest: as the baseline creates it", () => roleShape("viafrei_digest"));
  it("viafrei_mcp: as the baseline creates it", () => roleShape("viafrei_mcp"));
  it("viafrei_status: as the baseline creates it", () => roleShape("viafrei_status"));
  it("viafrei_ops: as the baseline creates it", () => roleShape("viafrei_ops"));
  it("viafrei_translate: as the baseline creates it", () => roleShape("viafrei_translate"));
  it("viafrei_ingestor: as the baseline creates it", () => roleShape("viafrei_ingestor"));
  it("api_reader: as 0307 creates it", () => roleShape("api_reader"));
  it("api_access: as 0308 creates it", () => roleShape("api_access"));
});
