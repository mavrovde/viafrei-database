-- Test-only fixture functions (#31 item 9): schema vf_test, and the two
-- schemas the clock and the shadows put in front of the search_path.
--
-- Installed ONLY by `viafrei-db test-fixtures install`, which refuses (exit 2)
-- unless VF_TEST_FIXTURES=1 is set and the database name starts with test_;
-- this file refuses again below, on the server's own current_database().
-- `migrate` and `serve` never read it (test/fixtures.db.test.ts).
--
-- Each function lifts exactly ONE guard, and only inside the caller's own
-- transaction, which it rolls back:
--
--   begin;
--   set local vf_test.armed = 'on';
--   select vf_test.unfreeze_station_slugs();
--   ... the plant, the test ...
--   rollback;
--
-- vf_test.armed() is the gate every function opens with: a test_ database,
-- the armed setting, and an explicit transaction block (the statement started
-- after the transaction did — in autocommit the two are one instant), so a
-- lift can never outlive the test that asked for it.
--
-- Idempotent: every object is created with `or replace` / `if not exists`.

DO $$
BEGIN
  IF current_database() NOT LIKE 'test\_%' THEN
    RAISE EXCEPTION 'vf_test fixtures are for a test_ database only, not %', current_database() USING ERRCODE = '42501';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS vf_test;
CREATE SCHEMA IF NOT EXISTS vf_test_clock;
CREATE SCHEMA IF NOT EXISTS vf_test_shadow;
REVOKE ALL ON SCHEMA vf_test FROM PUBLIC;

CREATE OR REPLACE FUNCTION vf_test.armed() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF current_database() NOT LIKE 'test\_%' THEN
    RAISE EXCEPTION 'vf_test: not a test_ database (%)', current_database() USING ERRCODE = '42501';
  END IF;
  IF coalesce(current_setting('vf_test.armed', true), '') <> 'on' THEN
    RAISE EXCEPTION 'vf_test: set local vf_test.armed = ''on'' first, inside the test''s transaction' USING ERRCODE = '55000';
  END IF;
  IF statement_timestamp() = transaction_timestamp() THEN
    RAISE EXCEPTION 'vf_test: not inside an explicit transaction block — a lift here would commit' USING ERRCODE = '25P01';
  END IF;
END $$;

-- station_slugs_frozen: a slug is never updated or deleted. Lifted to plant a
-- board's station under a slug of the test's choosing.
CREATE OR REPLACE FUNCTION vf_test.unfreeze_station_slugs() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM vf_test.armed();
  ALTER TABLE public.station_slugs DISABLE TRIGGER station_slugs_frozen;
END $$;

-- runtime_config_source_bounds: a source's runtime_config row stays inside its
-- licence floor. Lifted to plant an out-of-bounds row a reader must refuse.
CREATE OR REPLACE FUNCTION vf_test.lift_runtime_config_source_bounds() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM vf_test.armed();
  ALTER TABLE public.runtime_config DISABLE TRIGGER runtime_config_source_bounds;
END $$;

-- The postcode trigger <table>_postcode (vf_postcode_normalise) of one table:
-- lifted to plant a postcode as a feed wrote it, before normalising.
CREATE OR REPLACE FUNCTION vf_test.lift_postcode_trigger(relation regclass) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  trg name;
BEGIN
  PERFORM vf_test.armed();
  SELECT t.tgname INTO trg FROM pg_trigger t
   WHERE t.tgrelid = relation AND NOT t.tgisinternal AND t.tgfoid = 'public.vf_postcode_normalise()'::regprocedure;
  IF trg IS NULL THEN
    RAISE EXCEPTION 'vf_test: % has no postcode trigger', relation USING ERRCODE = '42704';
  END IF;
  EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', relation, trg);
END $$;

-- One CHECK constraint of one table (close-scope-867, error-events plant a row
-- an older writer wrote before the check existed). A key, a foreign key or a
-- NOT NULL is not a CHECK and is refused.
CREATE OR REPLACE FUNCTION vf_test.drop_check(relation regclass, constraint_name name) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM vf_test.armed();
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid = relation AND conname = constraint_name AND contype = 'c') THEN
    RAISE EXCEPTION 'vf_test: % has no CHECK constraint %', relation, constraint_name USING ERRCODE = '42704';
  END IF;
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', relation, constraint_name);
END $$;

-- The planner's n_distinct of one column (et-bridge-plan sets production's
-- figure on a small test table). Applied by the ANALYZE the caller runs next.
CREATE OR REPLACE FUNCTION vf_test.set_n_distinct(relation regclass, column_name name, n double precision) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM vf_test.armed();
  IF NOT EXISTS (SELECT FROM pg_attribute WHERE attrelid = relation AND attname = column_name AND attnum > 0 AND NOT attisdropped) THEN
    RAISE EXCEPTION 'vf_test: % has no column %', relation, column_name USING ERRCODE = '42703';
  END IF;
  EXECUTE format('ALTER TABLE %s ALTER COLUMN %I SET (n_distinct = %s)', relation, column_name, n);
END $$;

-- The clock (find_parking.clock): now() as the test says. vf_test_clock.now()
-- reads vf_test.clock; set_clock puts that schema before pg_catalog on the
-- transaction's search_path, so an unqualified now() in a query is the test's.
CREATE OR REPLACE FUNCTION vf_test_clock.now() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT current_setting('vf_test.clock')::timestamptz $$;
GRANT USAGE ON SCHEMA vf_test_clock TO PUBLIC;
GRANT EXECUTE ON FUNCTION vf_test_clock.now() TO PUBLIC;

CREATE OR REPLACE FUNCTION vf_test.set_clock(at timestamptz) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM vf_test.armed();
  PERFORM set_config('vf_test.clock', at::text, true);
  PERFORM set_config('search_path', 'vf_test_clock, pg_catalog, ' || current_setting('search_path'), true);
END $$;

-- The shadows (streets-deadline-1099, registered-sources): one relation seen
-- through a view of the same name and row type in vf_test_shadow, first on the
-- transaction's search_path, so an unqualified name in a query reads it. The
-- shadow is granted to every role that may select the original.
CREATE OR REPLACE FUNCTION vf_test.shadow_put(relation regclass, body text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  rel name;
  grantee name;
BEGIN
  PERFORM vf_test.armed();
  SELECT relname INTO rel FROM pg_class WHERE oid = relation;
  EXECUTE format('CREATE OR REPLACE VIEW vf_test_shadow.%I AS %s', rel, body);
  EXECUTE 'GRANT USAGE ON SCHEMA vf_test_shadow TO PUBLIC';
  FOR grantee IN
    SELECT DISTINCT a.grantee::regrole::text FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.oid = relation AND a.privilege_type = 'SELECT' AND a.grantee <> 0
  LOOP
    EXECUTE format('GRANT SELECT ON vf_test_shadow.%I TO %I', rel, grantee);
  END LOOP;
  IF position('vf_test_shadow' IN current_setting('search_path')) = 0 THEN
    PERFORM set_config('search_path', 'vf_test_shadow, ' || current_setting('search_path'), true);
  END IF;
END $$;

-- A relation slowed: every read of it waits `seconds` first, rows unchanged.
CREATE OR REPLACE FUNCTION vf_test.shadow_slow(relation regclass, seconds double precision) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM vf_test.shadow_put(relation, format('WITH w AS MATERIALIZED (SELECT pg_sleep(%s)) SELECT r.* FROM %s r, w', seconds, relation));
END $$;

-- A relation replaced by the test's rows (a jsonb array of objects keyed by column), its row type kept.
CREATE OR REPLACE FUNCTION vf_test.shadow_rows(relation regclass, rows jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM vf_test.shadow_put(relation, format('SELECT * FROM jsonb_populate_recordset(null::%s, %L::jsonb)', relation, rows));
END $$;

-- role-boot's mutant: one role loses SELECT on one relation, for this transaction.
CREATE OR REPLACE FUNCTION vf_test.revoke_select(relation regclass, role_name name) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM vf_test.armed();
  EXECUTE format('REVOKE SELECT ON %s FROM %I', relation, role_name);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vf_test FROM PUBLIC;
