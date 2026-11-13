/**
 * baseline-scrub: turns pg_dump / pg_dumpall output into the baseline's text,
 * and normalises a dump the same way for the equivalence check.
 *
 *   node scripts/baseline-scrub.ts dump  <owner> < pg_dump.sql      > body.sql
 *   node scripts/baseline-scrub.ts roles <owner> < roles-only.sql    > roles.sql
 *   node scripts/baseline-scrub.ts bodies <a.tsv> <b.tsv>          (equivalence)
 *   node scripts/baseline-scrub.ts schema <a.sql> <b.sql>          (equivalence)
 *
 * `dump` removes what is not schema: pg_dump's version header and its
 * \restrict / \unrestrict lines (a random key per run), every `--` comment
 * line (pg_dump's table of contents, and the comments that START IN CODE
 * inside a SQL or PL/pgSQL function body — never a line of a literal or a
 * nested $tag$ string), and every COMMENT ON statement. It keeps every byte of a COPY
 * block and of a quoted literal. The owner the dump was taken as becomes
 * CURRENT_USER, so the baseline belongs to whoever runs it.
 *
 * `roles` keeps the viafrei_* roles and nothing else. A role is created with
 * its attributes when it does not exist; one that exists with other
 * attributes is REFUSED, never altered (attributes are cluster-wide). Role
 * settings are scoped to the database the baseline runs in, the owner's to
 * CURRENT_USER there; GRANTED BY is dropped. An unknown statement is refused:
 * a human reads it.
 *
 * Exit 0 = written / bodies equivalent; 1 = bodies differ; 2 = refused (the reason on stderr).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export class ScrubError extends Error {}

const IDENT = /^[a-z_][a-z0-9_$]*$/;
const OUR_ROLE = /^viafrei_[a-z0-9_]+$/;

/**
 * Splits SQL text into statements and comment lines, aware of single-quoted
 * literals (E'' with backslash escapes), double-quoted identifiers,
 * dollar-quoted bodies and COPY … FROM stdin blocks. A `--` line inside a
 * dollar body is reported as a comment; inside a quoted literal or COPY data
 * it is data.
 */
type Piece = { readonly kind: "statement" | "comment" | "copy-data" | "meta"; text: string };

function pieces(sql: string): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  let stmt = "";
  const n = sql.length;
  const atLineStart = (k: number): boolean => k === 0 || sql[k - 1] === "\n";
  const lineEnd = (k: number): number => {
    const e = sql.indexOf("\n", k);
    return e < 0 ? n : e + 1;
  };
  const flush = (): void => {
    if (stmt.trim() !== "") out.push({ kind: "statement", text: stmt });
    else if (stmt !== "") out.push({ kind: "meta", text: stmt });
    stmt = "";
  };
  while (i < n) {
    // At the start of a line, outside any statement: a whole-line comment or a psql meta-command.
    if (atLineStart(i) && stmt.trim() === "") {
      const rest = sql.slice(i, lineEnd(i));
      if (/^\s*--/.test(rest)) {
        if (stmt !== "") out.push({ kind: "meta", text: stmt });
        stmt = "";
        out.push({ kind: "comment", text: rest });
        i += rest.length;
        continue;
      }
      if (rest.startsWith("\\")) {
        if (stmt !== "") out.push({ kind: "meta", text: stmt });
        stmt = "";
        out.push({ kind: "meta", text: rest });
        i += rest.length;
        continue;
      }
    }
    const c = sql[i] ?? "";
    // A whole-line comment inside a statement (e.g. between the clauses of a function body outside its quotes).
    if (atLineStart(i) && /^[ \t]*--/.test(sql.slice(i, lineEnd(i)))) {
      const e = lineEnd(i);
      out.push({ kind: "comment", text: sql.slice(i, e) });
      i = e;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      // A trailing comment after code on the same line: kept as written (it is not a line of its own).
      const e = lineEnd(i);
      stmt += sql.slice(i, e);
      i = e;
      continue;
    }
    if (c === "'") {
      const escaped = /[eE]$/.test(stmt) && !/[a-zA-Z0-9_]$/.test(stmt.slice(0, -1));
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new ScrubError("an unterminated quoted literal");
        if (escaped && sql[j] === "\\") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      stmt += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      const j = sql.indexOf('"', i + 1);
      if (j < 0) throw new ScrubError("an unterminated quoted identifier");
      stmt += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "$" && !/[a-zA-Z0-9_$]$/.test(stmt)) {
      const m = /^\$([a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(sql.slice(i));
      if (m !== null) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        if (close < 0) throw new ScrubError(`an unterminated dollar-quoted body ${tag}`);
        // A function or procedure body in SQL or PL/pgSQL loses its whole-line
        // comments, found by a lexer that skips its literals; any other
        // dollar-quoted text is data and is kept verbatim.
        const body = sql.slice(i + tag.length, close);
        stmt += tag + (isCodeBody(stmt) ? stripCodeComments(body) : body) + tag;
        i = close + tag.length;
        continue;
      }
    }
    if (c === ";") {
      stmt += ";";
      i += 1;
      // The rest of the line belongs to this statement (a trailing comment, the newline).
      const e = lineEnd(i);
      const tail = sql.slice(i, e);
      if (/^\s*(--.*)?\n?$/.test(tail)) {
        stmt += tail;
        i = e;
      }
      const isCopy = /^\s*COPY\s[^;]*\sFROM\s+stdin;/i.test(stmt);
      flush();
      if (isCopy) {
        const end = sql.indexOf("\n\\.\n", i - 1);
        if (end < 0) throw new ScrubError("a COPY block without its \\. terminator");
        out.push({ kind: "copy-data", text: sql.slice(i, end + 4) });
        i = end + 4;
      }
      continue;
    }
    stmt += c;
    i += 1;
  }
  flush();
  return out;
}

/** The statement so far is `CREATE [OR REPLACE] FUNCTION|PROCEDURE … LANGUAGE sql|plpgsql … AS`. */
function isCodeBody(stmtSoFar: string): boolean {
  const t = stmtSoFar.trimStart();
  return /^CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\s/i.test(t) && /\sLANGUAGE\s+(sql|plpgsql)\s/i.test(t) && /\sAS\s*$/i.test(t);
}

/**
 * A SQL or PL/pgSQL body without its whole-line `--` comments. A line is a
 * comment only when it STARTS in code: a line inside a '…' or E'…' literal,
 * a "…" identifier, a nested $tag$ string or a block comment is kept as it is.
 * The body begins mid-line (after its opening tag), so its first line is
 * never dropped.
 */
export function stripCodeComments(body: string): string {
  let out = "";
  let i = 0;
  let lineStart = false;
  const n = body.length;
  const upTo = (k: number): void => {
    out += body.slice(i, k);
    i = k;
  };
  while (i < n) {
    if (lineStart) {
      lineStart = false;
      const e = body.indexOf("\n", i);
      const line = body.slice(i, e < 0 ? n : e + 1);
      if (/^[ \t]*--/.test(line)) {
        i += line.length;
        lineStart = line.endsWith("\n");
        continue;
      }
    }
    const c = body[i];
    if (c === "\n") {
      upTo(i + 1);
      lineStart = true;
    } else if (c === "-" && body[i + 1] === "-") {
      const e = body.indexOf("\n", i);
      upTo(e < 0 ? n : e); // a trailing comment: kept, up to (not including) its newline
    } else if (c === "/" && body[i + 1] === "*") {
      let depth = 0;
      let j = i;
      do {
        if (j >= n) throw new ScrubError("an unterminated block comment in a function body");
        if (body.startsWith("/*", j)) {
          depth += 1;
          j += 2;
        } else if (body.startsWith("*/", j)) {
          depth -= 1;
          j += 2;
        } else j += 1;
      } while (depth > 0);
      upTo(j);
    } else if (c === "'") {
      const escaped = /[eE]$/.test(out) && !/[a-zA-Z0-9_]$/.test(out.slice(0, -1));
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new ScrubError("an unterminated literal in a function body");
        if (escaped && body[j] === "\\") j += 2;
        else if (body[j] === "'" && body[j + 1] === "'") j += 2;
        else if (body[j] === "'") break;
        else j += 1;
      }
      upTo(j + 1);
    } else if (c === '"') {
      const j = body.indexOf('"', i + 1);
      if (j < 0) throw new ScrubError("an unterminated identifier in a function body");
      upTo(j + 1);
    } else if (c === "$" && !/[a-zA-Z0-9_$]$/.test(out)) {
      const m = /^\$([a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(body.slice(i));
      if (m === null) upTo(i + 1);
      else {
        const close = body.indexOf(m[0], i + m[0].length);
        if (close < 0) throw new ScrubError(`an unterminated ${m[0]} string in a function body`);
        upTo(close + m[0].length);
      }
    } else upTo(i + 1);
  }
  return out;
}

/**
 * The function bodies of two databases, UNSCRUBBED, compared: each line
 * `<signature>\t<language>\t<base64 prosrc>`. A body equal byte for byte
 * passes. A body that differs passes only when B is A with lines deleted,
 * every deleted line is a whole-line `--` comment, and the lexer above,
 * applied to A, gives exactly B: the comments were proven to be comments.
 */
export function compareBodies(aText: string, bText: string): { ok: boolean; lines: string[] } {
  const read = (t: string, side: string): Map<string, { lang: string; src: string }> => {
    const m = new Map<string, { lang: string; src: string }>();
    for (const l of t.split("\n")) {
      if (l === "") continue;
      const [sig, lang, b64, ...rest] = l.split("\t");
      if (sig === undefined || lang === undefined || b64 === undefined || rest.length > 0) throw new ScrubError(`${side}: a line is not <signature>\\t<language>\\t<base64>`);
      if (m.has(sig)) throw new ScrubError(`${side}: ${sig} twice`);
      m.set(sig, { lang, src: Buffer.from(b64, "base64").toString("utf8") });
    }
    if (m.size === 0) throw new ScrubError(`${side}: no function at all — the listing read nothing`);
    return m;
  };
  const a = read(aText, "A");
  const b = read(bText, "B");
  const lines: string[] = [];
  let same = 0;
  let commentsOnly = 0;
  for (const sig of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const x = a.get(sig);
    const y = b.get(sig);
    if (x === undefined || y === undefined) {
      lines.push(`✗ ${sig}: only in ${x === undefined ? "B" : "A"}`);
      continue;
    }
    if (x.lang !== y.lang) lines.push(`✗ ${sig}: language ${x.lang} against ${y.lang}`);
    else if (x.src === y.src) same += 1;
    else if ((x.lang === "sql" || x.lang === "plpgsql") && stripCodeComments(x.src) === y.src && onlyCommentLinesDeleted(x.src, y.src)) commentsOnly += 1;
    else lines.push(`✗ ${sig}: the body differs in more than whole-line comments`);
  }
  const ok = lines.length === 0;
  lines.push(`${ok ? "✓" : "✗"} ${String(a.size)} function(s): ${String(same)} identical, ${String(commentsOnly)} differing only by whole-line comments`);
  return { ok, lines };
}

/** B's lines are A's in order, and every line of A not in B is a whole-line `--` comment. */
function onlyCommentLinesDeleted(a: string, b: string): boolean {
  const al = a.split("\n");
  const bl = b.split("\n");
  let j = 0;
  for (const l of al) {
    if (j < bl.length && bl[j] === l) j += 1;
    else if (!/^[ \t]*--/.test(l)) return false;
  }
  return j === bl.length;
}

const quoteIdent = (role: string): string => {
  if (!IDENT.test(role)) throw new ScrubError(`the owner '${role.slice(0, 40)}' is not a plain lower-case identifier`);
  return role;
};

/**
 * What the PostGIS image's own init puts into the database it creates
 * (POSTGRES_DB) and no migration does: the extensions and their schemas. A dump
 * holding one was taken from that database instead of a plain `create
 * database`, and is refused.
 */
export const IMAGE_EXTRAS = /^CREATE\s+(?:SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:tiger|tiger_data|topology)\s*;|EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:fuzzystrmatch|postgis_tiger_geocoder|postgis_topology)\b)/;

/** The schema dump, scrubbed. */

export function scrubDump(sql: string, owner: string): string {
  const o = quoteIdent(owner);
  const ownerRe = new RegExp(`(\\b(?:TO|FROM)\\s+)${o}(\\s*(?:;|,|WITH\\b|GRANTED\\b))`, "g");
  const out: string[] = [];
  for (const p of pieces(sql.replace(/\r\n/g, "\n"))) {
    if (p.kind === "comment") continue;
    if (p.kind === "meta") {
      if (/^\\(un)?restrict\b/.test(p.text)) continue;
      if (p.text.trim() === "") {
        out.push(p.text);
        continue;
      }
      throw new ScrubError(`an unexpected psql meta-command: ${p.text.slice(0, 60).trim()}`);
    }
    if (p.kind === "copy-data") {
      out.push(p.text);
      continue;
    }
    const head = p.text.trimStart();
    if (/^COMMENT\s+ON\s/i.test(head)) continue;
    if (IMAGE_EXTRAS.test(head)) throw new ScrubError(`the dump holds what the PostGIS image's init made, not a migration (${head.split("\n")[0]?.slice(0, 80) ?? ""}): dump a database made with a plain create database`);
    // The owner becomes CURRENT_USER only in the statements that name a role:
    // never inside a function body or a default, whose text is kept as dumped.
    if (/^(GRANT|REVOKE|ALTER\s+DEFAULT\s+PRIVILEGES)\s/i.test(head)) {
      out.push(p.text.replace(ownerRe, "$1CURRENT_USER$2").replace(new RegExp(`\\s+FOR\\s+ROLE\\s+${o}(?=\\s)`, "g"), "").replace(/\s+GRANTED\s+BY\s+[a-z0-9_]+(?=\s*;)/g, ""));
    } else if (/^ALTER\s+[\s\S]*\sOWNER\s+TO\s/i.test(head) && !head.includes("$")) {
      out.push(p.text.replace(new RegExp(`\\bOWNER\\s+TO\\s+${o}\\s*;`), "OWNER TO CURRENT_USER;"));
    } else {
      out.push(p.text);
    }
  }
  // Blank runs collapse to one blank line; the file ends in exactly one newline.
  return `${out.join("").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

const ATTRS: Record<string, readonly [string, boolean]> = {
  SUPERUSER: ["rolsuper", true],
  NOSUPERUSER: ["rolsuper", false],
  INHERIT: ["rolinherit", true],
  NOINHERIT: ["rolinherit", false],
  CREATEROLE: ["rolcreaterole", true],
  NOCREATEROLE: ["rolcreaterole", false],
  CREATEDB: ["rolcreatedb", true],
  NOCREATEDB: ["rolcreatedb", false],
  LOGIN: ["rolcanlogin", true],
  NOLOGIN: ["rolcanlogin", false],
  REPLICATION: ["rolreplication", true],
  NOREPLICATION: ["rolreplication", false],
  BYPASSRLS: ["rolbypassrls", true],
  NOBYPASSRLS: ["rolbypassrls", false],
};

/** `NOSUPERUSER INHERIT … CONNECTION LIMIT 60` → the pg_roles predicate those attributes mean. */
function attributePredicate(role: string, attrs: string): string {
  const conds: string[] = [];
  const words = attrs.split(" ");
  for (let k = 0; k < words.length; k += 1) {
    const w = words[k] ?? "";
    const a = ATTRS[w];
    if (a !== undefined) {
      if (a[1] && (w === "SUPERUSER" || w === "REPLICATION" || w === "BYPASSRLS")) throw new ScrubError(`ALTER ROLE ${role} grants a cluster privilege: ${w}`);
      conds.push(`${a[0]} = ${String(a[1])}`);
    } else if (w === "CONNECTION" && words[k + 1] === "LIMIT" && /^-?\d+$/.test(words[k + 2] ?? "")) {
      conds.push(`rolconnlimit = ${words[k + 2] ?? ""}`);
      k += 2;
    } else if (w === "PASSWORD") throw new ScrubError(`ALTER ROLE ${role} carries a password: dump with --no-role-passwords`);
    else throw new ScrubError(`ALTER ROLE ${role}: an attribute this scrub does not know: ${w}`);
  }
  return conds.join(" AND ");
}

/** `SET k TO v` of a role, scoped to the database the baseline runs in. */
function inDatabase(role: string, set: string): string {
  if (set.includes("$")) throw new ScrubError(`ALTER ROLE ${role} SET carries a '$': ${set.slice(0, 60)}`);
  const text = `ALTER ROLE ${role} IN DATABASE %I SET ${set.replace(/%/g, "%%")}`.replace(/'/g, "''");
  return `DO $$ BEGIN EXECUTE format('${text}', current_database()); END $$;`;
}

/** The roles-only dump, scrubbed to the viafrei_* roles. */
export function scrubRoles(sql: string, owner: string): string {
  const o = quoteIdent(owner);
  const created: string[] = [];
  const attrs = new Map<string, string>();
  const settings: string[] = [];
  const grants: string[] = [];
  for (const p of pieces(sql.replace(/\r\n/g, "\n"))) {
    if (p.kind === "comment") continue;
    if (p.kind === "meta") {
      if (/^\\(un)?restrict\b/.test(p.text) || p.text.trim() === "") continue;
      throw new ScrubError(`an unexpected psql meta-command: ${p.text.slice(0, 60).trim()}`);
    }
    if (p.kind === "copy-data") throw new ScrubError("a COPY block in a roles-only dump");
    const s = p.text.trim().replace(/\s+/g, " ");
    let m: RegExpExecArray | null;
    if (/^SET \w+ = .*;$/.test(s)) continue;
    if ((m = /^CREATE ROLE ([a-z0-9_]+);$/.exec(s)) !== null) {
      const r = m[1] ?? "";
      if (OUR_ROLE.test(r)) created.push(r);
      continue;
    }
    if ((m = /^ALTER ROLE ([a-z0-9_]+) WITH (.*);$/.exec(s)) !== null) {
      const r = m[1] ?? "";
      if (!OUR_ROLE.test(r)) continue;
      attributePredicate(r, m[2] ?? "");
      attrs.set(r, m[2] ?? "");
      continue;
    }
    if ((m = /^ALTER ROLE ([a-z0-9_]+) (IN DATABASE \S+ )?SET (.*);$/.exec(s)) !== null) {
      const r = m[1] ?? "";
      if (m[2] !== undefined) throw new ScrubError(`ALTER ROLE ${r} ${m[2].trim()}: a database name is not portable`);
      if (r === o) settings.push(inDatabase("CURRENT_USER", m[3] ?? ""));
      else if (OUR_ROLE.test(r)) settings.push(inDatabase(r, m[3] ?? ""));
      continue;
    }
    if ((m = /^GRANT ([a-z0-9_]+) TO ([a-z0-9_]+)(.*?)(?: GRANTED BY [a-z0-9_]+)?;$/.exec(s)) !== null) {
      const [, granted = "", grantee = "", opts = ""] = m;
      if (!OUR_ROLE.test(granted) && !granted.startsWith("pg_")) continue;
      const to = grantee === o ? "CURRENT_USER" : OUR_ROLE.test(grantee) ? grantee : null;
      if (to === null) continue;
      grants.push(`GRANT ${granted} TO ${to}${opts};`);
      continue;
    }
    throw new ScrubError(`an unexpected statement in the roles dump: ${s.slice(0, 80)}`);
  }
  if (created.length === 0) throw new ScrubError("no viafrei_* role in the roles dump");
  const out: string[] = [];
  for (const r of created) {
    const a = attrs.get(r);
    if (a === undefined) throw new ScrubError(`CREATE ROLE ${r} without its ALTER ROLE … WITH line`);
    out.push(
      [
        "DO $$",
        "BEGIN",
        `  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${r}') THEN`,
        `    CREATE ROLE ${r} WITH ${a};`,
        `  ELSIF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${r}' AND ${attributePredicate(r, a)}) THEN`,
        `    RAISE EXCEPTION 'role ${r} exists with other attributes than the baseline gives it; align it first (role attributes are cluster-wide and never altered here)';`,
        "  END IF;",
        "END $$;",
      ].join("\n"),
    );
  }
  return `${[...out, ...settings, ...grants].join("\n")}\n`;
}

/**
 * pg_dump does not round-trip byte for byte: a schema restored from its own
 * dump deparses differently in exactly two ways seen here, both without
 * meaning — nested AND groups come back as one flat chain, and an unnamed
 * constant column (`NULL::boolean`) comes back named after its type
 * (`NULL::boolean AS bool`). canonDeparse rewrites both, and nothing else, on
 * a line: AND chains are flattened (a group spliced only when it is a whole
 * operand of an AND and is itself an AND chain), and an alias is dropped only
 * when it is the type's own name on a NULL or literal constant. The view
 * column NAMES this could hide are compared from the catalogue separately
 * (scripts/baseline.sh, `columns`). A line with unbalanced parentheses or an
 * unterminated quote is left as it is.
 */
type DNode = { k: "s"; v: string } | { k: "q"; v: string } | { k: "g"; c: DNode[] };

function parseLine(line: string): DNode[] | null {
  const stack: DNode[][] = [[]];
  let text = "";
  const top = (): DNode[] => stack[stack.length - 1] ?? [];
  const flush = (): void => {
    if (text !== "") top().push({ k: "s", v: text });
    text = "";
  };
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? "";
    if (ch === "'" || ch === '"') {
      flush();
      const esc = ch === "'" && i > 0 && (line[i - 1] === "E" || line[i - 1] === "e") && !/[A-Za-z0-9_]/.test(line[i - 2] ?? " ");
      let j = i + 1;
      for (;;) {
        if (j >= line.length) return null;
        if (esc && line[j] === "\\") j += 2;
        else if (line[j] === ch && line[j + 1] === ch) j += 2;
        else if (line[j] === ch) break;
        else j += 1;
      }
      top().push({ k: "q", v: line.slice(i, j + 1) });
      i = j;
    } else if (ch === "(") {
      flush();
      const g: DNode = { k: "g", c: [] };
      top().push(g);
      stack.push(g.c);
    } else if (ch === ")") {
      flush();
      if (stack.length === 1) return null;
      stack.pop();
    } else text += ch;
  }
  flush();
  return stack.length === 1 ? (stack[0] ?? []) : null;
}

/** The nodes split at each top-level ` AND `. */
function andParts(nodes: readonly DNode[]): DNode[][] {
  const parts: DNode[][] = [[]];
  for (const n of nodes) {
    if (n.k !== "s" || !n.v.includes(" AND ")) {
      parts[parts.length - 1]?.push(n);
      continue;
    }
    const bits = n.v.split(" AND ");
    bits.forEach((b, i) => {
      if (i > 0) parts.push([]);
      if (b !== "") parts[parts.length - 1]?.push({ k: "s", v: b });
    });
  }
  return parts;
}

const hasTopOr = (nodes: readonly DNode[]): boolean => nodes.some((n) => n.k === "s" && / OR /.test(n.v));

function flatten(nodes: readonly DNode[]): DNode[] {
  const inner: DNode[] = nodes.map((n) => (n.k === "g" ? { k: "g", c: flatten(n.c) } : n));
  const parts = andParts(inner);
  if (parts.length < 2) return inner;
  const out: DNode[] = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push({ k: "s", v: " AND " });
    const only = p.length === 1 ? p[0] : undefined;
    if (only !== undefined && only.k === "g" && andParts(only.c).length >= 2 && !hasTopOr(only.c)) out.push(...only.c);
    else out.push(...p);
  });
  return out;
}

const render = (nodes: readonly DNode[]): string => nodes.map((n) => (n.k === "g" ? `(${render(n.c)})` : n.v)).join("");

const TYPE_ALIAS: Record<string, string> = {
  text: "text",
  boolean: "bool",
  integer: "int4",
  bigint: "int8",
  smallint: "int2",
  numeric: "numeric",
  "double precision": "float8",
  real: "float4",
  date: "date",
  "timestamp with time zone": "timestamptz",
  jsonb: "jsonb",
  json: "json",
};
const CONST_ALIAS = /^(\s*(?:SELECT\s+)?(?:NULL|'(?:[^']|'')*')::([a-z ]+?)) AS ([a-z0-9_]+)(,?)$/;

export function canonDeparse(text: string): { text: string; changed: number } {
  let changed = 0;
  const out = text.split("\n").map((line) => {
    let l = line;
    const m = CONST_ALIAS.exec(l);
    if (m !== null && TYPE_ALIAS[m[2] ?? ""] === m[3]) l = `${m[1] ?? ""}${m[4] ?? ""}`;
    if (l.includes(" AND ")) {
      const nodes = parseLine(l);
      if (nodes !== null) l = render(flatten(nodes));
    }
    if (l !== line) changed += 1;
    return l;
  });
  return { text: out.join("\n"), changed };
}

/** Two scrubbed schema dumps: equal, or equal once both are canonDeparse'd (the lines it touched counted). */
export function compareSchemas(aText: string, bText: string): { ok: boolean; lines: string[] } {
  if (aText.trim() === "" || bText.trim() === "") throw new ScrubError("an empty schema dump: nothing was compared");
  const n = aText.split("\n").length;
  if (aText === bText) return { ok: true, lines: [`  ✓ schema equal (${String(n)} lines)`] };
  const a = canonDeparse(aText);
  const b = canonDeparse(bText);
  if (a.text === b.text) {
    return { ok: true, lines: [`  ✓ schema equal (${String(n)} lines) once pg_dump's deparse round trip is normalised on both sides: ${String(a.changed)} line(s) of A and ${String(b.changed)} of B (flat AND chains, type-named aliases of constants)`] };
  }
  const al = a.text.split("\n");
  const bl = b.text.split("\n");
  const lines = ["  ✗ schema differ, also once the deparse round trip is normalised; first differences:"];
  for (let i = 0, shown = 0; i < Math.max(al.length, bl.length) && shown < 10; i += 1) {
    if (al[i] === bl[i]) continue;
    lines.push(`    line ${String(i + 1)}:`, `    - ${al[i] ?? "<none>"}`, `    + ${bl[i] ?? "<none>"}`);
    shown += 1;
  }
  return { ok: false, lines };
}

function main(argv: readonly string[]): number {
  const [mode, x, y] = argv;
  const usage = "usage: node scripts/baseline-scrub.ts dump|roles <owner> < in.sql > out.sql\n       node scripts/baseline-scrub.ts bodies <a.tsv> <b.tsv> | schema <a.sql> <b.sql>\n";
  try {
    if ((mode === "bodies" || mode === "schema") && x !== undefined && y !== undefined && argv.length === 3) {
      const r = (mode === "bodies" ? compareBodies : compareSchemas)(readFileSync(x, "utf8"), readFileSync(y, "utf8"));
      for (const l of r.lines) (r.ok ? process.stdout : process.stderr).write(`${l}\n`);
      return r.ok ? 0 : 1;
    }
    if ((mode !== "dump" && mode !== "roles") || x === undefined || argv.length !== 2) {
      process.stderr.write(usage);
      return 2;
    }
    const sql = readFileSync(0, "utf8");
    process.stdout.write(mode === "dump" ? scrubDump(sql, x) : scrubRoles(sql, x));
    return 0;
  } catch (e) {
    if (!(e instanceof ScrubError)) throw e;
    process.stderr.write(`✗ ${e.message}\n`);
    return 2;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
