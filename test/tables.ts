/**
 * Every table of ours (relkind r or p, no partition, no extension member), as
 * one shape table (test/tables/shape.tsv):
 *
 *   relation \t column \t <name> \t <type> [not null] [default <expr>] [identity always|by default] [generated <expr>]
 *   relation \t constraint \t <name> \t <p|u|f|x|t> <pg_get_constraintdef>
 *   relation \t index \t <name> \t <pg_get_indexdef>
 *
 * read with an empty search_path, so every name is qualified the way a dump
 * writes it. Checks are not here: test/checks/constraints.tsv holds them.
 *
 *   npx tsx test/tables.ts <database url>    prints the table of a migrated database
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const ROOT = join(import.meta.dirname, "..");

export const OURS = `
select c.oid, n.nspname || '.' || c.relname as relation
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p') and not c.relispartition
   and c.oid not in (select objid from pg_catalog.pg_depend where deptype = 'e')
   and n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'`;

export const SHAPE_SQL = `
with t as (${OURS})
select t.relation, 'column' as kind, a.attname::text as name,
       pg_catalog.format_type(a.atttypid, a.atttypmod)
         || case when a.attnotnull then ' not null' else '' end
         || case when a.atthasdef and a.attgenerated = '' then ' default ' || pg_catalog.pg_get_expr(d.adbin, d.adrelid) else '' end
         || case a.attidentity when 'a' then ' identity always' when 'd' then ' identity by default' else '' end
         || case when a.attgenerated <> '' then ' generated ' || pg_catalog.pg_get_expr(d.adbin, d.adrelid) else '' end as def,
       lpad(a.attnum::text, 4, '0') as ord
  from t join pg_catalog.pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
union all
select t.relation, 'constraint', k.conname::text, k.contype::text || ' ' || pg_catalog.pg_get_constraintdef(k.oid), k.conname::text
  from t join pg_catalog.pg_constraint k on k.conrelid = t.oid and k.contype <> 'c'
union all
select t.relation, 'index', ic.relname::text, pg_catalog.pg_get_indexdef(x.indexrelid), ic.relname::text
  from t join pg_catalog.pg_index x on x.indrelid = t.oid join pg_catalog.pg_class ic on ic.oid = x.indexrelid
 order by 1, 2, 5`;

export type ShapeRow = { readonly relation: string; readonly kind: "column" | "constraint" | "index"; readonly name: string; readonly def: string };

export async function readShape(c: pg.ClientBase): Promise<ShapeRow[]> {
  await c.query("begin");
  try {
    await c.query("set local search_path = ''");
    return (await c.query<ShapeRow>(SHAPE_SQL)).rows.map((r) => ({ relation: r.relation, kind: r.kind, name: r.name, def: r.def }));
  } finally {
    await c.query("rollback");
  }
}

const esc = (d: string): string => d.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n");
const unesc = (d: string): string => d.replace(/\\(.)/g, (_, ch: string) => (ch === "n" ? "\n" : ch === "t" ? "\t" : ch));

export const shapeLine = (r: ShapeRow): string => `${r.relation}\t${r.kind}\t${r.name}\t${esc(r.def)}`;

export function expectedShape(): ShapeRow[] {
  return readFileSync(join(ROOT, "test", "tables", "shape.tsv"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l, i) => {
      const cells = l.split("\t");
      if (cells.length !== 4 || !["column", "constraint", "index"].includes(cells[1] ?? "")) throw new Error(`tables/shape.tsv:${String(i + 1)}: ${JSON.stringify(l.slice(0, 80))}`);
      const [relation = "", kind = "", name = "", def = ""] = cells;
      return { relation, kind: kind as ShapeRow["kind"], name, def: unesc(def) };
    });
}

/** A value of `type` for a key column: equal in two rows, and naming nothing a referenced table holds. */
export function keyValue(type: string): string {
  if (/^(smallint|integer|bigint|numeric)/.test(type)) return "987";
  if (type === "boolean") return "true";
  if (type.startsWith("timestamp")) return "2026-01-01 00:00:00+00";
  if (type === "date") return "2026-01-01";
  if (type === "bytea") return "\\x01";
  return "zz-no-such";
}

/** A value of `type` for a key column unequal to keyValue's: a self-referencing row's own key. */
export function otherValue(type: string): string {
  if (/^(smallint|integer|bigint|numeric)/.test(type)) return "986";
  if (type.startsWith("timestamp")) return "2026-01-02 00:00:00+00";
  if (type === "date") return "2026-01-02";
  if (type === "bytea") return "\\x02";
  return "zz-own-row";
}

/* v8 ignore start — the generator, run by hand */
if (import.meta.filename === process.argv[1]) {
  const c = new pg.Client({ connectionString: process.argv[2] });
  await c.connect();
  const rows = await readShape(c);
  await c.end();
  process.stdout.write(
    "# Every table of ours (test/tables.ts): relation, column | constraint | index, name, definition; columns in attnum order.\n# A migration that changes a table changes its rows here in the same commit.\n" +
      rows.map((r) => `${shapeLine(r)}\n`).join(""),
  );
}
/* v8 ignore stop */
