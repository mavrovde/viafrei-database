/**
 * The expected privileges of every service role and of PUBLIC, as one table
 * (test/acl/expected.tsv), and the catalogue read it is compared with.
 *
 *   grantee \t kind \t object \t privileges
 *
 * kind: relation (a table, view or materialized view's own ACL), column
 * (`<relation>.<column>`), schema, function (`<schema>.<name>(<identity args>)`).
 * privileges: sorted, comma-separated; `*` after one means WITH GRANT OPTION.
 * Only grants to viafrei_* roles and to PUBLIC are read, never the owner's,
 * extension members or partitions.
 *
 * A migration that grants or revokes adds or removes its rows here in the
 * same commit; roles-grants.db.test.ts fails in both directions until it does.
 *
 *   npx tsx test/acl.ts <database url>    prints the table of a migrated database
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { testDatabase } from "./generator-input.js";

const ROOT = join(import.meta.dirname, "..");

export type AclRow = { readonly grantee: string; readonly kind: "relation" | "column" | "schema" | "function"; readonly object: string; readonly privileges: string };

export const ACL_SQL = `
with ext as (select objid from pg_depend where deptype = 'e'),
ours as (select oid, nspname from pg_namespace where nspname not like 'pg\\_%' and nspname <> 'information_schema'),
rel as (
  select c.oid, c.relowner, c.relacl, n.nspname || '.' || c.relname as name
    from pg_class c join ours n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p', 'v', 'm') and not c.relispartition and c.oid not in (select objid from ext)
),
x as (
  select 'relation' as kind, r.name as object, r.relowner as owner, a.*
    from rel r cross join lateral aclexplode(r.relacl) a
  union all
  select 'column', r.name || '.' || att.attname, r.relowner, a.*
    from rel r join pg_attribute att on att.attrelid = r.oid and att.attnum > 0 and not att.attisdropped
   cross join lateral aclexplode(att.attacl) a
  union all
  select 'schema', n.nspname, s.nspowner, a.*
    from ours n join pg_namespace s on s.oid = n.oid cross join lateral aclexplode(s.nspacl) a
  union all
  select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', p.proowner, a.*
    from pg_proc p join ours n on n.oid = p.pronamespace cross join lateral aclexplode(p.proacl) a
   where p.oid not in (select objid from ext)
)
select coalesce(g.rolname, 'PUBLIC') as grantee, x.kind, x.object,
       string_agg(x.privilege_type || case when x.is_grantable then '*' else '' end, ',' order by x.privilege_type) as privileges
  from x left join pg_roles g on g.oid = x.grantee
 where x.grantee <> x.owner and (x.grantee = 0 or g.rolname like 'viafrei\\_%')
 group by 1, 2, 3
 order by 1, 2, 3`;

export async function readAcl(c: pg.ClientBase | pg.Pool): Promise<AclRow[]> {
  return (await c.query<AclRow>(ACL_SQL)).rows;
}

export const key = (r: AclRow): string => `${r.grantee}\t${r.kind}\t${r.object}\t${r.privileges}`;

export function parseAcl(text: string): AclRow[] {
  const out: AclRow[] = [];
  text.split("\n").forEach((l, i) => {
    if (l.trim() === "" || l.startsWith("#")) return;
    const [grantee, kind, object, privileges, ...rest] = l.split("\t");
    if (grantee === undefined || object === undefined || privileges === undefined || rest.length > 0 || !["relation", "column", "schema", "function"].includes(kind ?? "")) {
      throw new Error(`expected.tsv:${String(i + 1)}: not grantee, kind, object, privileges: ${JSON.stringify(l)}`);
    }
    out.push({ grantee, kind: kind as AclRow["kind"], object, privileges });
  });
  return out;
}

export const expectedAcl = (): AclRow[] => parseAcl(readFileSync(join(ROOT, "test", "acl", "expected.tsv"), "utf8"));

/* v8 ignore start — the generator, run by hand */
if (import.meta.filename === process.argv[1]) {
  const c = new pg.Client(testDatabase(process.argv[2]));
  await c.connect();
  const rows = await readAcl(c);
  await c.end();
  process.stdout.write(
    "# The expected privileges of the service roles and PUBLIC (test/acl.ts): grantee, kind, object, privileges.\n# A migration that grants or revokes changes its rows here in the same commit.\n" +
      rows.map((r) => `${key(r)}\n`).join(""),
  );
}
/* v8 ignore stop */
