import { describe, expect, it } from "vitest";
import { canonDeparse, compareBodies, compareSchemas, scrubDump, scrubRoles, ScrubError, stripCodeComments } from "../scripts/baseline-scrub.js";

const OWNER = "owner_x";

describe("scrubDump", () => {
  it("drops pg_dump's header, its \\restrict lines and its table-of-contents comments", () => {
    const dump = [
      "--",
      "-- PostgreSQL database dump",
      "--",
      "\\restrict AbCdEf0123",
      "-- Dumped from database version 16.9",
      "-- Dumped by pg_dump version 16.9",
      "SET statement_timeout = 0;",
      "",
      "--",
      "-- Name: a; Type: TABLE; Schema: public; Owner: -",
      "--",
      "",
      "CREATE TABLE public.a (id integer);",
      "\\unrestrict AbCdEf0123",
      "",
    ].join("\n");
    expect(scrubDump(dump, OWNER)).toBe("SET statement_timeout = 0;\n\nCREATE TABLE public.a (id integer);\n");
  });

  it("keeps our own schemas as dumped", () => {
    const dump = ["CREATE SCHEMA control;", "CREATE SCHEMA tigerx;", "CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;", ""].join("\n\n");
    expect(scrubDump(dump, OWNER)).toBe(["CREATE SCHEMA control;", "CREATE SCHEMA tigerx;", "CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;"].join("\n\n") + "\n");
  });

  it.each([
    "CREATE SCHEMA tiger;",
    "CREATE SCHEMA tiger_data;",
    "CREATE SCHEMA IF NOT EXISTS topology;",
    "CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;",
    "CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder WITH SCHEMA tiger;",
    "CREATE EXTENSION postgis_topology WITH SCHEMA topology;",
  ])("refuses %s: what the PostGIS image's init made is no migration's", (stmt) => {
    expect(() => scrubDump(`CREATE SCHEMA control;\n\n${stmt}\n`, OWNER)).toThrow(/plain create database/);
  });

  it("drops every COMMENT ON statement, also one whose literal holds a semicolon, a quote and a newline", () => {
    const dump = "CREATE TABLE public.a (id integer);\nCOMMENT ON TABLE public.a IS 'one; it''s\n-- not a comment line';\nCREATE TABLE public.b (id integer);\n";
    expect(scrubDump(dump, OWNER)).toBe("CREATE TABLE public.a (id integer);\nCREATE TABLE public.b (id integer);\n");
  });

  it("drops whole-line comments inside a dollar-quoted body and keeps the code and trailing comments", () => {
    const dump = [
      "CREATE FUNCTION public.f() RETURNS integer",
      "    LANGUAGE plpgsql",
      "    AS $_$",
      "begin",
      "  -- why this is here (#123)",
      "    -- and more",
      "  return 1; -- kept: not a line of its own",
      "end",
      "$_$;",
      "",
    ].join("\n");
    expect(scrubDump(dump, OWNER)).toBe(["CREATE FUNCTION public.f() RETURNS integer", "    LANGUAGE plpgsql", "    AS $_$", "begin", "  return 1; -- kept: not a line of its own", "end", "$_$;", ""].join("\n"));
  });

  it("keeps a body line that is DATA: inside a '…' literal, an E'…' literal, a nested $tag$ string or a block comment", () => {
    const fn = (lang: string, body: string): string => `CREATE FUNCTION public.f() RETURNS text\n    LANGUAGE ${lang}\n    AS $_$${body}$_$;\n`;
    const bodies = [
      "\nbegin\n  return 'line one\n-- not a comment, data\nend';\nend\n",
      "\nbegin\n  return E'it\\'s\n  -- data in an escaped literal\n';\nend\n",
      "\nbegin\n  execute $q$select 1\n-- data in a nested string\n$q$;\nend\n",
      "\nbegin\n  /* a block\n-- inside a block comment\n*/ return 'x';\nend\n",
      "\nbegin\n  return 'a'; -- don't: a trailing comment holding a quote\n  -- dropped\n  return 'b';\nend\n",
    ];
    expect(scrubDump(fn("plpgsql", bodies[0] ?? ""), OWNER)).toBe(fn("plpgsql", bodies[0] ?? ""));
    expect(scrubDump(fn("plpgsql", bodies[1] ?? ""), OWNER)).toBe(fn("plpgsql", bodies[1] ?? ""));
    expect(scrubDump(fn("plpgsql", bodies[2] ?? ""), OWNER)).toBe(fn("plpgsql", bodies[2] ?? ""));
    expect(scrubDump(fn("plpgsql", bodies[3] ?? ""), OWNER)).toBe(fn("plpgsql", bodies[3] ?? ""));
    expect(scrubDump(fn("plpgsql", bodies[4] ?? ""), OWNER)).toBe(fn("plpgsql", (bodies[4] ?? "").replace("  -- dropped\n", "")));
  });

  it("strips comments only from SQL and PL/pgSQL function bodies: another dollar string is kept verbatim", () => {
    const other = "CREATE FUNCTION public.p() RETURNS int LANGUAGE plpython3u AS $_$\n# x\n-- kept\nreturn 1\n$_$;\n";
    const dflt = "CREATE TABLE public.t (s text DEFAULT $$a\n-- kept$$);\n";
    expect(scrubDump(other, OWNER)).toBe(other);
    expect(scrubDump(dflt, OWNER)).toBe(dflt);
  });

  it("keeps a nested dollar tag, $1 parameters and a $ inside an identifier", () => {
    const dump = "CREATE FUNCTION public.g(t text) RETURNS text LANGUAGE sql AS $$ select format($q$x$q$, $1) $$;\nCREATE TABLE public.\"a$b\" (\"c;d\" integer);\n";
    expect(scrubDump(dump, OWNER)).toBe(dump);
  });

  it("keeps COPY data byte for byte, even lines that look like comments or COMMENT ON", () => {
    const dump = "COPY public.a (t) FROM stdin;\n-- not a comment\nCOMMENT ON nothing;\n\\N\n\\.\n\nCOPY public.b (t) FROM stdin;\n\\.\n\nCREATE TABLE public.c (id integer);\n";
    expect(scrubDump(dump, OWNER)).toBe(dump);
  });

  it("keeps an E'' literal with backslash escapes intact", () => {
    const dump = "INSERT INTO public.a VALUES (E'it\\'s; -- data\\n');\n";
    expect(scrubDump(dump, OWNER)).toBe(dump);
  });

  it("names the owner CURRENT_USER in grants, revokes, ownership and default privileges only", () => {
    const dump = [
      "GRANT SELECT ON TABLE public.a TO viafrei_mcp;",
      "REVOKE ALL ON SCHEMA public FROM owner_x;",
      "GRANT ALL ON SCHEMA public TO owner_x;",
      "GRANT SELECT ON TABLE public.a TO viafrei_digest GRANTED BY owner_x;",
      "ALTER DEFAULT PRIVILEGES FOR ROLE owner_x IN SCHEMA public GRANT SELECT ON TABLES TO viafrei_status;",
      "ALTER TABLE public.a OWNER TO owner_x;",
      "CREATE FUNCTION public.h() RETURNS void LANGUAGE sql AS $$ grant select on public.a to owner_x; $$;",
      "",
    ].join("\n");
    expect(scrubDump(dump, OWNER)).toBe(
      [
        "GRANT SELECT ON TABLE public.a TO viafrei_mcp;",
        "REVOKE ALL ON SCHEMA public FROM CURRENT_USER;",
        "GRANT ALL ON SCHEMA public TO CURRENT_USER;",
        "GRANT SELECT ON TABLE public.a TO viafrei_digest;",
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO viafrei_status;",
        "ALTER TABLE public.a OWNER TO CURRENT_USER;",
        "CREATE FUNCTION public.h() RETURNS void LANGUAGE sql AS $$ grant select on public.a to owner_x; $$;",
        "",
      ].join("\n"),
    );
  });

  it("normalises CRLF and blank runs, and is idempotent", () => {
    const once = scrubDump("CREATE TABLE a (id int);\r\n\r\n\r\n\r\nCREATE TABLE b (id int);\r\n", OWNER);
    expect(once).toBe("CREATE TABLE a (id int);\n\nCREATE TABLE b (id int);\n");
    expect(scrubDump(once, OWNER)).toBe(once);
  });

  it.each([
    ["an unterminated literal", "INSERT INTO a VALUES ('x);\n", "unterminated quoted literal"],
    ["an unterminated body", "CREATE FUNCTION f() AS $x$ begin;\n", "unterminated dollar-quoted body $x$"],
    ["a COPY without its terminator", "COPY a (t) FROM stdin;\nrow\n", "without its \\. terminator"],
    ["an unknown meta-command", "\\connect other\n", "unexpected psql meta-command"],
  ])("refuses %s", (_n, sql, msg) => {
    expect(() => scrubDump(sql, OWNER)).toThrow(ScrubError);
    expect(() => scrubDump(sql, OWNER)).toThrow(msg);
  });

  it("refuses an owner that is not a plain identifier (it is put into a pattern)", () => {
    expect(() => scrubDump("", "a.*")).toThrow("not a plain lower-case identifier");
  });
});

describe("stripCodeComments", () => {
  it("never drops the body's first line, which starts mid-line after the tag", () => {
    expect(stripCodeComments(" -- first\n-- second\nselect 1\n")).toBe(" -- first\nselect 1\n");
  });
  it("handles nested block comments and refuses unterminated ones", () => {
    expect(stripCodeComments("\n/* a /* b */\n-- in */\nx")).toBe("\n/* a /* b */\n-- in */\nx");
    expect(() => stripCodeComments("\n/* open")).toThrow("unterminated block comment");
    expect(() => stripCodeComments("\nreturn 'x")).toThrow("unterminated literal");
  });
});

describe("compareBodies", () => {
  const line = (sig: string, lang: string, src: string): string => `${sig}\t${lang}\t${Buffer.from(src).toString("base64")}`;
  const A = "\nbegin\n  -- why (#1)\n  return 'a\n-- data\n';\nend\n";
  const B = "\nbegin\n  return 'a\n-- data\n';\nend\n";

  it("passes identical bodies and bodies that differ only by whole-line comments", () => {
    const r = compareBodies([line("f()", "plpgsql", A), line("g()", "sql", " select 1 ")].join("\n"), [line("f()", "plpgsql", B), line("g()", "sql", " select 1 ")].join("\n"));
    expect(r).toEqual({ ok: true, lines: ["✓ 2 function(s): 1 identical, 1 differing only by whole-line comments"] });
  });

  it.each([
    ["a data line lost from a literal", "\nbegin\n  -- why (#1)\n  return 'a\n';\nend\n", "✗ f(): the body differs in more than whole-line comments"],
    ["a code change", B.replace("'a", "'b"), "✗ f(): the body differs in more than whole-line comments"],
  ])("refuses %s", (_n, b, msg) => {
    const r = compareBodies(line("f()", "plpgsql", A), line("f()", "plpgsql", b));
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toBe(msg);
  });

  it("refuses a missing function, another language, and an empty listing", () => {
    expect(compareBodies(`${line("f()", "sql", "x")}\n${line("g()", "sql", "y")}`, line("f()", "sql", "x")).lines[0]).toBe("✗ g(): only in A");
    expect(compareBodies(line("f()", "sql", "x"), line("f()", "plpgsql", "x")).lines[0]).toBe("✗ f(): language sql against plpgsql");
    expect(() => compareBodies("", line("f()", "sql", "x"))).toThrow("A: no function at all");
    expect(() => compareBodies("f()\tsql", line("f()", "sql", "x"))).toThrow("A: a line is not");
  });

  it("does not accept a comment-only difference in a language it cannot lex", () => {
    expect(compareBodies(line("p()", "plpython3u", "\n-- x\nreturn 1\n"), line("p()", "plpython3u", "\nreturn 1\n")).ok).toBe(false);
  });
});

describe("scrubRoles", () => {
  const dump = [
    "--",
    "-- PostgreSQL database cluster dump",
    "--",
    "\\restrict Key123",
    "SET default_transaction_read_only = off;",
    "CREATE ROLE owner_x;",
    "ALTER ROLE owner_x WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS;",
    "CREATE ROLE postgres;",
    "CREATE ROLE viafrei_mcp;",
    "ALTER ROLE viafrei_mcp WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 32;",
    "CREATE ROLE viafrei_ops;",
    "ALTER ROLE viafrei_ops WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS;",
    "ALTER ROLE owner_x SET statement_timeout TO '120s';",
    "ALTER ROLE viafrei_mcp SET search_path TO 'public', '%x';",
    "ALTER ROLE postgres SET work_mem TO '64MB';",
    "GRANT viafrei_mcp TO owner_x WITH INHERIT TRUE GRANTED BY owner_x;",
    "GRANT pg_read_all_stats TO viafrei_ops GRANTED BY owner_x;",
    "GRANT pg_signal_backend TO postgres GRANTED BY owner_x;",
    "\\unrestrict Key123",
    "",
  ].join("\n");

  const created = (r: string, attrs: string, pred: string): string =>
    [
      "DO $$",
      "BEGIN",
      `  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${r}') THEN`,
      `    CREATE ROLE ${r} WITH ${attrs};`,
      `  ELSIF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${r}' AND ${pred}) THEN`,
      `    RAISE EXCEPTION 'role ${r} exists with other attributes than the baseline gives it; align it first (role attributes are cluster-wide and never altered here)';`,
      "  END IF;",
      "END $$;",
    ].join("\n");
  const PRED = "rolsuper = false AND rolinherit = true AND rolcreaterole = false AND rolcreatedb = false AND rolcanlogin = true AND rolreplication = false AND rolbypassrls = false";

  it("creates each viafrei_* role with its attributes only when it is missing, and refuses one that differs", () => {
    expect(scrubRoles(dump, OWNER)).toBe(
      [
        created("viafrei_mcp", "NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 32", `${PRED} AND rolconnlimit = 32`),
        created("viafrei_ops", "NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS", PRED),
        "DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET statement_timeout TO ''120s''', current_database()); END $$;",
        "DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET search_path TO ''public'', ''%%x''', current_database()); END $$;",
        "GRANT viafrei_mcp TO CURRENT_USER WITH INHERIT TRUE;",
        "GRANT pg_read_all_stats TO viafrei_ops;",
        "",
      ].join("\n"),
    );
  });

  it("never emits an ALTER ROLE … WITH, nor a cluster-wide SET", () => {
    const out = scrubRoles(dump, OWNER);
    expect(out).not.toMatch(/ALTER ROLE \w+ WITH/);
    expect(out).not.toMatch(/ALTER ROLE \w+ SET/);
  });

  it.each([
    ["a password", "CREATE ROLE viafrei_a;\nALTER ROLE viafrei_a WITH LOGIN PASSWORD 'md5x';\n", "carries a password"],
    ["a cluster privilege", "CREATE ROLE viafrei_a;\nALTER ROLE viafrei_a WITH SUPERUSER;\n", "grants a cluster privilege"],
    ["a database-scoped setting", "CREATE ROLE viafrei_a;\nALTER ROLE viafrei_a IN DATABASE prod SET x TO 1;\n", "a database name is not portable"],
    ["an unknown attribute", "CREATE ROLE viafrei_a;\nALTER ROLE viafrei_a WITH LOGIN VALID UNTIL 'x';\n", "an attribute this scrub does not know: VALID"],
    ["a role without its attributes", "CREATE ROLE viafrei_a;\n", "without its ALTER ROLE"],
    ["a $ in a setting", "CREATE ROLE viafrei_a;\nALTER ROLE viafrei_a WITH LOGIN;\nALTER ROLE viafrei_a SET x TO '$1';\n", "carries a '$'"],
    ["an unknown statement", "CREATE ROLE viafrei_a;\nDROP ROLE viafrei_b;\n", "an unexpected statement"],
    ["no role of ours", "CREATE ROLE postgres;\n", "no viafrei_* role"],
  ])("refuses %s", (_n, sql, msg) => {
    expect(() => scrubRoles(sql, OWNER)).toThrow(msg);
  });
});

describe("canonDeparse and compareSchemas (pg_dump's deparse round trip)", () => {
  const A = [
    "    CONSTRAINT x_evas CHECK ((((cardinality(e) >= 1) AND (cardinality(e) <= 4)) AND (array_position(e, NULL::text) IS NULL))),",
    "    CONSTRAINT x_band CHECK ((((s >= 0) AND (s <= 23)) AND ((t >= 0) AND (t <= 24)) AND (s <> t))),",
    "                 SELECT 'kreis'::text,",
    "                    NULL::boolean AS untimed,",
    "                    NULL::integer",
  ].join("\n");
  const B = [
    "    CONSTRAINT x_evas CHECK (((cardinality(e) >= 1) AND (cardinality(e) <= 4) AND (array_position(e, NULL::text) IS NULL))),",
    "    CONSTRAINT x_band CHECK (((s >= 0) AND (s <= 23) AND ((t >= 0) AND (t <= 24)) AND (s <> t))),",
    "                 SELECT 'kreis'::text AS text,",
    "                    NULL::boolean AS untimed,",
    "                    NULL::integer AS int4",
  ].join("\n");

  it("equates the round trip seen on the real schema, and counts the lines it touched", () => {
    const r = compareSchemas(A, B);
    expect(r.ok, r.lines.join("\n")).toBe(true);
    expect(r.lines[0]).toMatch(/once pg_dump's deparse round trip is normalised on both sides: 2 line\(s\) of A and 3 of B/);
  });
  it("says plainly when the dumps are equal byte for byte", () => {
    expect(compareSchemas(A, A).lines).toEqual(["  ✓ schema equal (5 lines)"]);
  });
  it.each([
    ["an AND regrouped across an OR", "CHECK (((a OR b) AND c))", "CHECK ((a OR (b AND c)))"],
    ["an operand group with an OR at its top level", "CHECK (((a AND b OR c) AND d))", "CHECK ((a AND b OR c AND d))"],
    ["a NOT group", "CHECK (((NOT (a AND b)) AND c))", "CHECK (((NOT a) AND b AND c))"],
    ["a changed operand", "CHECK ((((a) AND (b)) AND (c)))", "CHECK (((a) AND (b) AND (d)))"],
    ["an alias that is not the type's name", "    NULL::boolean AS untimed,", "    NULL::boolean,"],
    ["an alias on a column, not a constant", "    t.x::boolean AS bool,", "    t.x::boolean,"],
    ["an AND inside a literal", "CHECK ((x = '(a AND b) AND c'::text))", "CHECK ((x = '(a AND b AND c'::text))"],
  ])("does not equate %s", (_n, a, b) => {
    const r = compareSchemas(a, b);
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toContain("line 1:");
  });
  it("leaves a line with unbalanced parentheses or an open quote as it is", () => {
    for (const l of ["    WHERE ((a AND (b", "    x = 'it''s (a AND b"]) expect(canonDeparse(l)).toEqual({ text: l, changed: 0 });
  });
  it("keeps E'' escapes and doubled quotes inside a literal", () => {
    const l = "CHECK ((((x = E'a\\'(b AND c'::text) AND (y = 'a''b')) AND (z)))";
    expect(canonDeparse(l).text).toBe("CHECK (((x = E'a\\'(b AND c'::text) AND (y = 'a''b') AND (z)))");
  });
  it("refuses an empty dump", () => {
    expect(() => compareSchemas("", "x")).toThrow(ScrubError);
  });
});
