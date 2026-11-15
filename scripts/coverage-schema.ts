/**
 * The schema coverage gate (#32): every object in the catalogue of a database
 * migrated to head by this checkout's files has a row in
 * test/coverage/schema.tsv naming the test(s) that prove it, or, while the
 * gap is being closed, a row in test/coverage/gap.tsv that says it has none.
 *
 *   npm run coverage:schema                 a throwaway database next to
 *                                           TEST_DATABASE_URL, migrated, read, dropped
 *   npm run coverage:schema -- --url URL    a database already migrated to head
 *                                           (the image smoke's, for one)
 *   ... -- --gap                            print every uncovered object as gap.tsv
 *                                           rows on stdout, and nothing else
 *
 * Fails (exit 1) when an object has neither a manifest nor a gap row, when a
 * manifest row names an object or a test that does not exist, when a gap row
 * names an object that does not exist, or one the manifest now covers (the
 * gap only shrinks). Refuses (exit 2) instead of passing when the catalogue
 * read is empty or a kind it must hold reads nothing, when the database is
 * not at the checkout's head, when the manifest has no row, and when the test
 * listing finds no test or a named test file cannot be read.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import pg from "pg";

export const KINDS = ["table", "view", "function", "trigger", "check", "policy", "grant", "role", "partitioned", "fixture"] as const;
export type Kind = (typeof KINDS)[number];
/** Kinds the migrated schema always holds: a catalogue read with none of one of them read the wrong database. */
export const REQUIRED_KINDS: readonly Kind[] = ["table", "view", "function", "trigger", "check", "policy", "grant", "role", "partitioned"];

export type Obj = { readonly kind: Kind; readonly name: string };
export type ManifestRow = { readonly kind: Kind; readonly name: string; readonly file: string; readonly title: string; readonly line: number };
export type GapRow = { readonly kind: Kind; readonly name: string; readonly line: number };

export class Refusal extends Error {}

const key = (o: { kind: string; name: string }): string => `${o.kind}\t${o.name}`;
const isKind = (k: string): k is Kind => (KINDS as readonly string[]).includes(k);

function rows(text: string, where: string, width: number): { cells: string[]; line: number }[] {
  const out: { cells: string[]; line: number }[] = [];
  text.split("\n").forEach((raw, i) => {
    const l = raw.replace(/\r$/, "");
    if (l.trim() === "" || l.startsWith("#")) return;
    const cells = l.split("\t");
    if (cells.length !== width || cells.some((c) => c.trim() === "" || c !== c.trim())) {
      throw new Refusal(`${where}:${String(i + 1)}: expected ${String(width)} non-empty tab-separated cells, got ${JSON.stringify(l)}`);
    }
    if (!isKind(cells[0] ?? "")) throw new Refusal(`${where}:${String(i + 1)}: unknown kind ${JSON.stringify(cells[0])} (one of ${KINDS.join(", ")})`);
    out.push({ cells, line: i + 1 });
  });
  return out;
}

/** kind, object, test — the test as `<file> > <title>`, the file relative to the repository. */
export function parseManifest(text: string, where = "schema.tsv"): ManifestRow[] {
  return rows(text, where, 3).map(({ cells, line }) => {
    const [kind, name, test] = cells as [Kind, string, string];
    const at = test.indexOf(" > ");
    if (at <= 0 || at + 3 >= test.length) throw new Refusal(`${where}:${String(line)}: the test must be "<file> > <title>", got ${JSON.stringify(test)}`);
    return { kind, name, file: test.slice(0, at), title: test.slice(at + 3), line };
  });
}

export function parseGap(text: string, where = "gap.tsv"): GapRow[] {
  return rows(text, where, 2).map(({ cells, line }) => ({ kind: cells[0] as Kind, name: cells[1] as string, line }));
}

/**
 * The titles of the it()/test() calls of a test file, read from its source:
 * a string or a template literal without a substitution, after it/test and an
 * optional .skip/.only/.each(...)/.skipIf(...) modifier. A title built at run
 * time cannot be named by the manifest.
 */
export function listTitles(source: string): Set<string> {
  const titles = new Set<string>();
  const re = /\b(?:it|test)(?:\.(?:skip|only|todo|concurrent|sequential|fails))?(?:\.(?:each|skipIf|runIf|for)\((?:[^()]|\([^()]*\))*\))?\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\$]|\\.|\$(?!\{))*)`)/g;
  for (const m of source.matchAll(re)) {
    const t = m[1] ?? m[2] ?? m[3];
    if (t !== undefined) titles.add(t.replace(/\\(.)/g, "$1"));
  }
  return titles;
}

/** Every test file under test/ (recursively), relative to the root, with its titles. */
export function listTests(root: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.test\.ts$/.test(e.name)) out.set(relative(root, p), listTitles(readFileSync(p, "utf8")));
    }
  };
  const top = join(root, "test");
  try {
    walk(top);
  } catch (e) {
    throw new Refusal(`the test listing could not read ${top}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const n = [...out.values()].reduce((s, t) => s + t.size, 0);
  if (out.size === 0 || n === 0) throw new Refusal(`the test listing under ${join(root, "test")} found ${String(out.size)} file(s) and ${String(n)} title(s): nothing to name`);
  return out;
}

export type Verdict = {
  readonly perKind: ReadonlyMap<Kind, { objects: number; covered: number; gap: number }>;
  readonly missing: readonly Obj[];
  readonly stale: readonly ManifestRow[];
  readonly unknownTests: readonly ManifestRow[];
  readonly staleGap: readonly GapRow[];
  readonly coveredGap: readonly GapRow[];
  readonly ok: boolean;
};

export function judge(catalogue: readonly Obj[], manifest: readonly ManifestRow[], gap: readonly GapRow[], tests: ReadonlyMap<string, ReadonlySet<string>>): Verdict {
  for (const k of REQUIRED_KINDS) {
    if (!catalogue.some((o) => o.kind === k)) throw new Refusal(`the catalogue read returned no ${k}: not a database migrated to head`);
  }
  if (manifest.length === 0) throw new Refusal("the manifest has no row: a gate over nothing proves nothing");
  const objects = new Set(catalogue.map(key));
  const named = new Set(manifest.map(key));
  const gapped = new Set(gap.map(key));
  const missing = catalogue.filter((o) => !named.has(key(o)) && !gapped.has(key(o)));
  const stale = manifest.filter((r) => !objects.has(key(r)));
  const unknownTests = manifest.filter((r) => !(tests.get(r.file)?.has(r.title) ?? false));
  const staleGap = gap.filter((r) => !objects.has(key(r)));
  const coveredGap = gap.filter((r) => objects.has(key(r)) && named.has(key(r)));
  const perKind = new Map<Kind, { objects: number; covered: number; gap: number }>();
  for (const k of KINDS) {
    const of = catalogue.filter((o) => o.kind === k);
    perKind.set(k, { objects: of.length, covered: of.filter((o) => named.has(key(o))).length, gap: of.filter((o) => !named.has(key(o)) && gapped.has(key(o))).length });
  }
  const ok = missing.length + stale.length + unknownTests.length + staleGap.length + coveredGap.length === 0;
  return { perKind, missing, stale, unknownTests, staleGap, coveredGap, ok };
}

export function report(v: Verdict): string {
  const out: string[] = [];
  for (const o of v.missing) out.push(`  ✗ ${o.kind} ${o.name}: no manifest row and no gap row`);
  for (const r of v.stale) out.push(`  ✗ schema.tsv:${String(r.line)}: ${r.kind} ${r.name} is not in the catalogue`);
  for (const r of v.unknownTests) out.push(`  ✗ schema.tsv:${String(r.line)}: no test "${r.title}" in ${r.file}`);
  for (const r of v.staleGap) out.push(`  ✗ gap.tsv:${String(r.line)}: ${r.kind} ${r.name} is not in the catalogue — remove the row`);
  for (const r of v.coveredGap) out.push(`  ✗ gap.tsv:${String(r.line)}: ${r.kind} ${r.name} has a manifest row now — remove the gap row`);
  let objects = 0;
  let covered = 0;
  let gap = 0;
  const parts: string[] = [];
  for (const [k, c] of v.perKind) {
    objects += c.objects;
    covered += c.covered;
    gap += c.gap;
    parts.push(`${k} ${String(c.covered)}/${String(c.objects)}`);
  }
  out.push(`${v.ok ? "✓" : "✗"} schema coverage: ${String(covered)} of ${String(objects)} catalogue object(s) proved, ${String(gap)} in the gap, ${String(v.missing.length)} missing, ${String(v.stale.length + v.staleGap.length)} stale, ${String(v.unknownTests.length)} unknown test(s) — ${parts.join(", ")}`);
  return out.join("\n");
}

/** The catalogue of a migrated database, as the manifest names its objects. Extension members and partitions are not ours. */
export const CATALOGUE_SQL = `
with ext as (select objid from pg_depend where deptype = 'e'),
ours as (select oid, nspname from pg_namespace where nspname not like 'pg\\_%' and nspname <> 'information_schema'),
rel as (
  select c.oid, c.relkind, n.nspname || '.' || c.relname as name
    from pg_class c join ours n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p', 'v', 'm') and not c.relispartition and c.oid not in (select objid from ext)
)
select 'table' as kind, name from rel where relkind in ('r', 'p')
union all select 'partitioned', name from rel where relkind = 'p'
union all select 'view', name from rel where relkind in ('v', 'm')
union all
select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join ours n on n.oid = p.pronamespace where p.oid not in (select objid from ext)
union all
select 'trigger', r.name || '.' || t.tgname from pg_trigger t join rel r on r.oid = t.tgrelid where not t.tgisinternal
union all
select 'check', r.name || '.' || k.conname from pg_constraint k join rel r on r.oid = k.conrelid where k.contype = 'c'
union all
select 'policy', r.name || '.' || p.polname from pg_policy p join rel r on r.oid = p.polrelid
union all
select distinct 'grant', coalesce(g.rolname, 'PUBLIC') || '@' || r.name
  from rel r join pg_class c on c.oid = r.oid cross join lateral aclexplode(c.relacl) x
  left join pg_roles g on g.oid = x.grantee
 where x.grantee <> c.relowner and (x.grantee = 0 or g.rolname like 'viafrei\\_%')
union all
select 'role', rolname from pg_roles where rolname like 'viafrei\\_%'
order by 1, 2`;

/**
 * The test-only fixture functions (db/test-fixtures/vf_test.sql, #31 item 9):
 * not in a migrated catalogue by design, so they are read from their file, one
 * object per `CREATE OR REPLACE FUNCTION <schema>.<name>(`.
 */
export function fixtureObjects(sql: string): Obj[] {
  return [...sql.matchAll(/^CREATE OR REPLACE FUNCTION (vf_test[a-z_]*\.[a-z_]+)\(/gm)].map((m) => ({ kind: "fixture" as const, name: m[1] ?? "" }));
}

/** Refuses a catalogue that holds a fixture schema: migrate and serve never install it, so such a database is not a migrated one. */
export function withFixtures(objects: readonly Obj[], fixtureSql: string): Obj[] {
  const leaked = objects.filter((o) => /^vf_test/.test(o.name));
  if (leaked.length > 0) throw new Refusal(`the catalogue holds ${String(leaked.length)} vf_test object(s) (${leaked[0]?.name ?? ""} …): the fixtures were installed on it, so it is not a database migrate made`);
  const fixtures = fixtureObjects(fixtureSql);
  if (fixtures.length === 0) throw new Refusal("db/test-fixtures/vf_test.sql defines no fixture function: a gate over nothing proves nothing");
  return [...objects, ...fixtures];
}

export async function readCatalogue(client: pg.ClientBase): Promise<{ objects: Obj[]; head: number | null }> {
  const ledger = await client.query<{ t: string | null }>("select to_regclass('public.schema_migrations')::text as t");
  if (ledger.rows[0]?.t == null) throw new Refusal("the database has no schema_migrations: it was never migrated");
  const r = await client.query<{ kind: string; name: string }>(CATALOGUE_SQL);
  const h = await client.query<{ head: number | null }>("select max(version)::int as head from schema_migrations");
  const objects: Obj[] = [];
  for (const x of r.rows) {
    if (!isKind(x.kind)) throw new Refusal(`the catalogue read returned an unknown kind ${x.kind}`);
    objects.push({ kind: x.kind, name: x.name });
  }
  return { objects, head: h.rows[0]?.head ?? null };
}

/** The checkout's head: the highest NNNN of db/baseline and db/migrations. */
export function checkoutHead(root: string): number {
  let head = 0;
  for (const d of ["db/baseline", "db/migrations"]) {
    let names: string[] = [];
    try {
      names = readdirSync(join(root, d));
    } catch {
      continue;
    }
    for (const n of names) {
      const m = /^(\d{4})_[^/]*\.sql$/.exec(n);
      if (m) head = Math.max(head, Number(m[1]));
    }
  }
  if (head === 0) throw new Refusal(`no migration file under ${root}: no head to compare the database with`);
  return head;
}

async function main(argv: readonly string[]): Promise<number> {
  const root = join(import.meta.dirname, "..");
  const at = argv.indexOf("--url");
  const given = at >= 0 ? argv[at + 1] : undefined;
  if (at >= 0 && (given === undefined || given.startsWith("--"))) throw new Refusal("--url needs a database URL");
  const gapOnly = argv.includes("--gap");
  const head = checkoutHead(root);
  let objects: Obj[];
  let dbHead: number | null;
  if (given !== undefined) {
    const c = new pg.Client({ connectionString: given });
    await c.connect();
    try {
      ({ objects, head: dbHead } = await readCatalogue(c));
    } finally {
      await c.end();
    }
  } else {
    const admin = process.env["TEST_DATABASE_URL"];
    if (admin === undefined || admin === "") throw new Refusal("neither --url nor TEST_DATABASE_URL: no database to read the catalogue of");
    const { loadConfig } = await import("../src/config.js");
    const { DatabaseService } = await import("../src/service.js");
    const name = `test_vfdb_coverage_${String(process.pid)}`;
    const pool = new pg.Pool({ connectionString: admin, max: 1 });
    const own = new URL(admin);
    own.pathname = `/${name}`;
    const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
    let svc: InstanceType<typeof DatabaseService> | undefined;
    try {
      await pool.query(`drop database if exists ${name} with (force)`);
      await pool.query(`create database ${name}`);
      svc = new DatabaseService({ config: loadConfig({ DATABASE_URL: own.toString(), DB_MIGRATE_LOCK_PAUSE_S: "1" }, "serve"), log: quiet });
      await svc.boot(1_000);
      const c = new pg.Client({ connectionString: own.toString() });
      await c.connect();
      try {
        ({ objects, head: dbHead } = await readCatalogue(c));
      } finally {
        await c.end();
      }
    } finally {
      await svc?.close();
      await pool.query(`drop database if exists ${name} with (force)`);
      await pool.end();
    }
  }
  objects = withFixtures(objects, readFileSync(join(root, "db", "test-fixtures", "vf_test.sql"), "utf8"));
  if (dbHead !== head) throw new Refusal(`the database is at ${String(dbHead)}, the checkout's head is ${String(head)}: its catalogue is not this schema's`);
  const manifest = parseManifest(readFileSync(join(root, "test", "coverage", "schema.tsv"), "utf8"));
  const gap = parseGap(readFileSync(join(root, "test", "coverage", "gap.tsv"), "utf8"));
  const tests = listTests(root);
  if (gapOnly) {
    const named = new Set(manifest.map(key));
    process.stdout.write(objects.filter((o) => !named.has(key(o))).map((o) => `${o.kind}\t${o.name}\n`).join(""));
    return 0;
  }
  const v = judge(objects, manifest, gap, tests);
  console.log(report(v));
  return v.ok ? 0 : 1;
}

if (import.meta.filename === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Refusal ? `✗ refused: ${e.message}` : e);
      process.exit(e instanceof Refusal ? 2 : 1);
    },
  );
}
