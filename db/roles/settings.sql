-- The role settings of this schema, scoped to the database being migrated:
-- what the baseline (and any migration after it) sets with
-- ALTER ROLE ... IN DATABASE. Settings are held per (role, database) in
-- pg_db_role_setting, so a database made as a copy of another
-- (CREATE DATABASE ... TEMPLATE) has NONE of them, and `migrate` finds nothing
-- pending there. `migrate` therefore applies this file after every successful
-- run, and `roles settings` applies it alone. Idempotent: each statement sets
-- the value it names. test/consumer.db.test.ts holds it equal to the
-- baseline's own statements and to every later migration's.
--
-- Precedence: every statement here is applied IN DATABASE, and a per-database
-- role setting wins over the same role's all-databases setting (ALTER ROLE ...
-- SET without IN DATABASE) and over the database-wide one, whenever either is
-- changed. A later all-databases change therefore does NOT take effect in this
-- database; change the value here instead.
--
-- Privilege: ALTER ROLE on another role needs CREATEROLE (and, in PostgreSQL
-- 16, the ADMIN option on that role) or a superuser. A migrator role without
-- it fails on the first statement that names another role, and `migrate` and
-- `roles settings` report the run as failed rather than as applied.
--
-- The last statement is the one DATABASE-WIDE setting production holds
-- (pg_db_role_setting with no role, measured 2026-11-15, test/roles/prod-settings.tsv):
-- PostGIS's search_path. It is per database too, so it is applied the same way.
--
-- THE MEMORY BOUND: the work_mem, multiplier and parallel settings below are
-- the inputs of a worst-case memory arithmetic, and
-- test/memory-bound.test.ts re-derives every figure from these lines and
-- holds the settings of this file equal to them, so a setting moved without
-- the arithmetic is red. What decides `connections` (the pools) and the
-- headroom (the database service's memory limit and shared_buffers) lives in
-- the consumers and the deploy, and is judged there.
--
--   per reader role, worst case = connections × work_mem × hash_mem_multiplier × nodes
--   bound: viafrei_digest connections=7 work_mem_mb=16 hash_mem_multiplier=1 nodes=2
--   bound: viafrei_mcp connections=18 work_mem_mb=16 hash_mem_multiplier=1 nodes=2
--   readers ≤ 80 % of the headroom; everything ≤ cap_pct of it:
--   bound: owner_role work_mem_mb=16 hash_mem_multiplier=1 parallel_per_gather=0 maintenance_work_mem_mb=64 parallel_maintenance=0
--   bound: build budget_mb=82 floor_mb=16 hash_mem_multiplier=1 temp_file_limit_mb=6144
--   bound: build_nodes gtfs_untimed_trips=1 gtfs_route_kreise=3 transit_stop_modes=5
--   bound: owner_other connections=2 work_mem_mb=16 hash_mem_multiplier=1 nodes=2 processes=1
--   bound: autovacuum workers=3 work_mem_mb=30
--   bound: readers_mb=800
--   bound: headroom_mb=1152 cap_pct=90
--   the build budget = floor(cap − readers − owner_other − autovacuum); per build
--   work_mem = max(floor_mb, floor(budget / nodes)).
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET work_mem TO ''16MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET hash_mem_multiplier TO ''1.0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET max_parallel_workers_per_gather TO ''0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET jit TO ''off''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET maintenance_work_mem TO ''64MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET max_parallel_maintenance_workers TO ''0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET statement_timeout TO ''5s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET default_transaction_read_only TO ''on''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET idle_in_transaction_session_timeout TO ''10s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET "TimeZone" TO ''UTC''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET jit TO ''off''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET work_mem TO ''16MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET hash_mem_multiplier TO ''1.0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET max_parallel_workers_per_gather TO ''0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET log_parameter_max_length TO ''0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET log_parameter_max_length_on_error TO ''0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_ingestor IN DATABASE %I SET statement_timeout TO ''120s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_ingestor IN DATABASE %I SET idle_in_transaction_session_timeout TO ''300s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_ingestor IN DATABASE %I SET "TimeZone" TO ''UTC''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET statement_timeout TO ''10s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET idle_in_transaction_session_timeout TO ''30s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET "TimeZone" TO ''UTC''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET jit TO ''off''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET work_mem TO ''16MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET hash_mem_multiplier TO ''1.0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET max_parallel_workers_per_gather TO ''1''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_ops IN DATABASE %I SET statement_timeout TO ''5s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_ops IN DATABASE %I SET idle_in_transaction_session_timeout TO ''10s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_ops IN DATABASE %I SET "TimeZone" TO ''UTC''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_status IN DATABASE %I SET statement_timeout TO ''5s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_status IN DATABASE %I SET default_transaction_read_only TO ''on''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_status IN DATABASE %I SET idle_in_transaction_session_timeout TO ''10s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_status IN DATABASE %I SET "TimeZone" TO ''UTC''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_status IN DATABASE %I SET jit TO ''off''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_translate IN DATABASE %I SET statement_timeout TO ''2s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_translate IN DATABASE %I SET lock_timeout TO ''1s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_translate IN DATABASE %I SET idle_in_transaction_session_timeout TO ''10s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_translate IN DATABASE %I SET "TimeZone" TO ''UTC''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE api_reader IN DATABASE %I SET default_transaction_read_only TO ''on''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE api_reader IN DATABASE %I SET statement_timeout TO ''2s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE api_reader IN DATABASE %I SET idle_in_transaction_session_timeout TO ''5s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE api_access IN DATABASE %I SET statement_timeout TO ''2s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE api_access IN DATABASE %I SET idle_in_transaction_session_timeout TO ''5s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET search_path TO "$user", public, topology, tiger', current_database()); END $$;
