/**
 * Every CHECK constraint of ours, as one table (test/checks/constraints.tsv):
 *
 *   relation \t constraint \t pg_get_constraintdef \t plant (a JSON object column -> value) | -
 *
 * The definition is read with an empty search_path, so it is qualified the
 * way a dump writes it; its backslashes, tabs and newlines are written \\,
 * \t and \n so a row stays one line. The PLANT is one row holding those
 * values and nothing else, inserted as the owner, which the database must
 * refuse with exactly this constraint (SQLSTATE 23514). A check no plant here
 * reaches is `-` and stays in the coverage gap.
 *
 * The plant isolates the check: in a savepoint it switches user triggers and
 * foreign keys off (session_replication_role = replica, and DISABLE TRIGGER
 * USER for the ones enabled ALWAYS), drops the relation's
 * primary key, every OTHER check and every NOT NULL but the partition key's
 * and the planted columns', gives a partitioned relation without a default
 * partition one, and fills a partition key the plant does not name and that
 * has no default with now(); everything is rolled back.
 *
 *   npx tsx test/checks.ts <database url> [existing constraints.tsv]
 *     prints the table: an existing plant that still works is kept (the hand
 *     plants of multi-column checks live there), else one value is searched
 *     for each column the check names; CHECKS_HAND=<file.json> adds candidate
 *     rows by constraint name ({"<name>": [{"<column>": "<value>"}, ...]})
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const ROOT = join(import.meta.dirname, "..");

export type CheckRow = { readonly relation: string; readonly name: string; readonly def: string; readonly plant: Readonly<Record<string, string>> | null };

export const CHECKS_SQL = `
with ext as (select objid from pg_depend where deptype = 'e')
select n.nspname || '.' || c.relname as relation, k.conname as name, pg_catalog.pg_get_constraintdef(k.oid) as def
  from pg_catalog.pg_constraint k join pg_catalog.pg_class c on c.oid = k.conrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where k.contype = 'c' and c.relkind in ('r', 'p') and not c.relispartition and c.oid not in (select objid from ext)
   and n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'
 order by 1, 2`;

export async function readChecks(c: pg.ClientBase): Promise<{ relation: string; name: string; def: string }[]> {
  await c.query("begin");
  try {
    await c.query("set local search_path = ''");
    return (await c.query<{ relation: string; name: string; def: string }>(CHECKS_SQL)).rows;
  } finally {
    await c.query("rollback");
  }
}

export const escapeDef = (d: string): string => d.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n");
export const unescapeDef = (d: string): string => d.replace(/\\(.)/g, (_, ch: string) => (ch === "n" ? "\n" : ch === "t" ? "\t" : ch));

export function parseChecks(text: string): CheckRow[] {
  const out: CheckRow[] = [];
  text.split("\n").forEach((l, i) => {
    if (l.trim() === "" || l.startsWith("#")) return;
    const cells = l.split("\t");
    if (cells.length !== 4) throw new Error(`constraints.tsv:${String(i + 1)}: expected 4 cells, got ${String(cells.length)}`);
    const [relation = "", name = "", def = "", plant = ""] = cells;
    out.push({ relation, name, def: unescapeDef(def), plant: plant === "-" ? null : (JSON.parse(plant) as Record<string, string>) });
  });
  return out;
}

export const CHECKS_FILE = join(ROOT, "test", "checks", "constraints.tsv");
export const expectedChecks = (file = CHECKS_FILE): CheckRow[] => parseChecks(readFileSync(file, "utf8"));
export const checkLine = (r: CheckRow): string => `${r.relation}\t${r.name}\t${escapeDef(r.def)}\t${r.plant === null ? "-" : JSON.stringify(r.plant)}`;

/** The columns a check names (identifiers in its definition that are columns of the relation). */
export function columnsOf(def: string, columns: readonly string[]): string[] {
  const words = new Set(def.replace(/'(?:[^']|'')*'/g, "").match(/[a-z_][a-z0-9_]*/g) ?? []);
  return columns.filter((c) => words.has(c));
}

export type PlantResult = { readonly code: string | null; readonly constraint: string | null };

/**
 * One plant: the row `row` in `relation`, every other guard lifted as
 * the header says, inside a savepoint that is rolled back. The client must be
 * in a transaction. `lift` drops the check itself too: the control that the
 * same row is then accepted, so the refusal is the check's and nothing else's.
 */
export async function plant(c: pg.ClientBase, relation: string, row: Readonly<Record<string, string>>, check: string, lift = false): Promise<PlantResult> {
  await c.query("savepoint plant");
  try {
    await c.query("set local session_replication_role = replica");
    const [schema = "", rel = ""] = relation.split(".");
    const meta = await c.query<{ pk: string | null; parted: boolean; hasdefault: boolean; key: string[]; cols: { name: string; notnull: boolean; identity: boolean; generated: boolean; hasdefault: boolean }[] }>(
      `select (select conname from pg_constraint where conrelid = c.oid and contype = 'p') as pk, c.relkind = 'p' as parted,
              exists (select from pg_partitioned_table p where p.partrelid = c.oid and p.partdefid <> 0) as hasdefault,
              coalesce((select array_agg(a.attname::text) from pg_partitioned_table p cross join unnest(p.partattrs) k(n) join pg_attribute a on a.attrelid = c.oid and a.attnum = k.n where p.partrelid = c.oid), '{}') as key,
              (select json_agg(json_build_object('name', a.attname, 'notnull', a.attnotnull, 'identity', a.attidentity <> '', 'generated', a.attgenerated <> '', 'hasdefault', a.atthasdef))
                 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as cols
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2`,
      [schema, rel],
    );
    const m = meta.rows[0];
    if (m === undefined) throw new Error(`${relation}: no such relation`);
    if (m.pk !== null) await c.query(`alter table ${relation} drop constraint ${pg.escapeIdentifier(m.pk)} cascade`);
    await c.query(`alter table ${relation} disable trigger user`);
    const others = await c.query<{ n: string }>("select conname as n from pg_constraint where conrelid = $1::regclass and contype = 'c' and (conname <> $2 or $3) and coninhcount = 0", [relation, check, lift]);
    for (const o of others.rows) await c.query(`alter table ${relation} drop constraint ${pg.escapeIdentifier(o.n)}`);
    for (const col of m.cols) {
      if (col.notnull && !col.identity && !col.generated && !m.key.includes(col.name) && !(col.name in row)) {
        await c.query(`alter table ${relation} alter column ${pg.escapeIdentifier(col.name)} drop not null`);
      }
    }
    if (m.parted && !m.hasdefault) await c.query(`create table ${pg.escapeIdentifier(schema)}.zz_check_plant partition of ${relation} default`);
    const named = Object.keys(row);
    const fill = m.cols.filter((x) => m.key.includes(x.name) && !x.hasdefault && !named.includes(x.name)).map((x) => x.name);
    const cols = [...named, ...fill].map((x) => pg.escapeIdentifier(x)).join(", ");
    const vals = [...named.map((_, i) => `$${String(i + 1)}`), ...fill.map(() => "now()")].join(", ");
    try {
      await c.query(`insert into ${relation} (${cols}) values (${vals})`, Object.values(row));
      return { code: null, constraint: null };
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      return { code: err.code ?? "?", constraint: err.constraint ?? null };
    }
  } finally {
    await c.query("rollback to savepoint plant");
  }
}

/** What the generator tries, in order, for a check on one column of type `type` (format_type). */
export function candidates(def: string, type = "text"): string[] {
  const out: string[] = [];
  const time = type.startsWith("timestamp") || type === "date";
  const geo = type.startsWith("geometry") || type.startsWith("geography");
  const json = type === "jsonb" || type === "json";
  if (time) out.push("2026-01-01 00:30:17.5+00", "2999-01-01 00:00:00+00", "1900-01-01 00:00:00+00", "2026-01-02 00:00:00+00");
  if (geo) out.push("SRID=4326;LINESTRING(0 0,1 1)", "SRID=4326;POINT(0 0)", "SRID=4326;POINT(200 100)", "SRID=4326;POINT EMPTY", "SRID=4326;POLYGON((0 0,1 0,1 1,0 0))");
  const longer = /length\(.+?\)+ <=? (\d+)/.exec(def);
  if (json && longer !== null) out.push(JSON.stringify("x".repeat(Number(longer[1]))));
  if (json) out.push('"x"', "{}", "[]", "null", "1", '["zz-not-allowed"]', '{"zz":1}', "[1]");
  if (type.endsWith("[]")) out.push("{zz-not-allowed}", "{}", "{NULL}", "{a,a}", '{""}');
  if (type === "boolean") out.push("true", "false");
  if (time || geo || json || type === "boolean") return out;
  const bound = /([<>]=?) \(?'?(-?\d+(?:\.\d+)?)'?(?:::[a-z ]+)?\)?/.exec(def);
  if (bound !== null) {
    const n = Number(bound[2]);
    out.push(String(bound[1]?.startsWith(">") ? n - 1 : n + 1));
  }
  if (longer !== null) out.push("x".repeat(Number(longer[1]) + 1));
  out.push("", "zz-not-allowed", "Zz", " a", "a ", "a\nb", "-1", "0", " ", "!", "ZZ", "1e9", "x".repeat(10_001), "{}", "[]", "2999-01-01", "1900-01-01", "f", "-0.001", "100000000");
  return [...new Set(out)];
}

/* v8 ignore start — the generator, run by hand */
if (import.meta.filename === process.argv[1]) {
  const c = new pg.Client({ connectionString: process.argv[2] });
  await c.connect();
  const kept = new Map((process.argv[3] === undefined ? [] : expectedChecks(process.argv[3])).map((r) => [`${r.relation}.${r.name}`, r.plant]));
  const hand = (process.env.CHECKS_HAND === undefined ? {} : JSON.parse(readFileSync(process.env.CHECKS_HAND, "utf8"))) as Record<string, Record<string, string>[]>;
  const all = await readChecks(c);
  const lines: string[] = [];
  await c.query("begin");
  const hit = async (relation: string, row: Record<string, string>, name: string): Promise<boolean> => {
    const r = await plant(c, relation, row, name);
    return r.code === "23514" && r.constraint === name;
  };
  for (const k of all) {
    let found: Record<string, string> | null = null;
    const old = kept.get(`${k.relation}.${k.name}`);
    if (old != null && (await hit(k.relation, old, k.name))) found = old;
    for (const row of found === null ? (hand[k.name] ?? []) : []) {
      if (await hit(k.relation, row, k.name)) {
        found = row;
        break;
      }
    }
    const [schema = "", rel = ""] = k.relation.split(".");
    const cols = (
      await c.query<{ a: string; t: string }>(
        "select a.attname as a, format_type(a.atttypid, a.atttypmod) as t from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2 and a.attnum > 0 and not a.attisdropped",
        [schema, rel],
      )
    ).rows;
    const types = new Map(cols.map((x) => [x.a, x.t]));
    for (const col of found === null ? columnsOf(k.def, cols.map((x) => x.a)) : []) {
      for (const v of candidates(k.def, types.get(col))) {
        if (await hit(k.relation, { [col]: v }, k.name)) {
          found = { [col]: v };
          break;
        }
      }
      if (found !== null) break;
    }
    if (found === null) process.stderr.write(`no plant: ${k.relation} ${k.name}\n`);
    lines.push(checkLine({ ...k, plant: found }));
  }
  await c.query("rollback");
  await c.end();
  process.stdout.write(
    "# Every CHECK constraint of ours (test/checks.ts): relation, constraint, definition, a plant row that breaks it alone (JSON) or -.\n# A migration that adds, changes or drops a check changes its row here in the same commit.\n" +
      lines.sort().map((l) => `${l}\n`).join(""),
  );
}
/* v8 ignore stop */
