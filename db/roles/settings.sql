-- The role settings of this schema, scoped to the database being migrated:
-- what the baseline (and any migration after it) sets with
-- ALTER ROLE ... IN DATABASE. Settings are held per (role, database) in
-- pg_db_role_setting, so a database made as a copy of another
-- (CREATE DATABASE ... TEMPLATE) has NONE of them, and `migrate` finds nothing
-- pending there. `migrate` therefore applies this file after every successful
-- run, and `roles settings` applies it alone. Idempotent: each statement sets
-- the value it names, once. test/roles.test.ts holds it equal to what the
-- baseline's statements and every later migration's leave in force (a later
-- statement of a role's setting replacing an earlier one), and
-- test/consumer.db.test.ts a migrated database equal to it.
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
--   THE MODEL: every session of a role at once, each with `nodes` sort or hash
--   nodes at their full size: worst case = connections × work_mem ×
--   hash_mem_multiplier × nodes. `connections` is NOT the pools' maximum but
--   the measured peak of the role's sessions plus 30 %, rounded up (owner
--   2026-11-19). Measured read-only on production, pg_stat_activity every
--   10 s for 10 minutes, 2026-11-19 21:36-21:46 UTC (60 samples), with a
--   single read at 21:0x UTC: peak sessions per login role
--   bound: peaks viafrei=25 viafrei_digest=25 viafrei_mcp=9 viafrei_ingestor=2 viafrei_translate=1 margin_pct=30
--   (no other login role held a session).
--   bound: viafrei_digest connections=33 work_mem_mb=64 hash_mem_multiplier=2 nodes=2
--   bound: viafrei_mcp connections=12 work_mem_mb=64 hash_mem_multiplier=2 nodes=2
--   readers ≤ 80 % of the headroom; everything ≤ cap_pct of it:
--   bound: owner_role work_mem_mb=64 hash_mem_multiplier=2 parallel_per_gather=0 maintenance_work_mem_mb=256 parallel_maintenance=0
--   the build runs on one of the owner's sessions, so owner_other = the owner's
--   connections less that one:
--   bound: build budget_mb=9586 floor_mb=64 hash_mem_multiplier=1 temp_file_limit_mb=6144
--   bound: build_nodes gtfs_untimed_trips=1 gtfs_route_kreise=3 transit_stop_modes=5
--   bound: owner_other connections=32 work_mem_mb=64 hash_mem_multiplier=2 nodes=2 processes=1
--   every other login role runs at the server's work_mem (32MB on the
--   production command line) and PostgreSQL's default multiplier 2:
--   bound: others connections=5 work_mem_mb=32 hash_mem_multiplier=2 nodes=2
--   one index build at a time (migrations run one file after another):
--   bound: maintenance builds=1 maintenance_work_mem_mb=256
--   bound: autovacuum workers=3 work_mem_mb=30
--   bound: readers_mb=11520
--   the headroom is the database pod's memory limit less shared_buffers:
--   bound: pod_mb=40960 shared_buffers_mb=7168 headroom_mb=33792 cap_pct=90
--   total = readers + owner_other + others + maintenance + autovacuum + the
--   build budget = 30284 MB, under the cap of 30412.8 MB; per build
--   work_mem = max(floor_mb, floor(budget / nodes)).
--
--   The pod is the production database pod at 40 GiB (owner 2026-11-19; the
--   infra change goes live before this repository's next release is pinned),
--   with shared_buffers 7 GB: the largest whole GB under which this total
--   fits (8 GB gives a cap of 29491.2 MB). Until 0321 the bound was the 1.5 GB
--   compose container's (1152 MB headroom), at work_mem 16MB and multiplier 1.
--   Each setting is written once, at the value in force: the baseline's
--   value where no later migration changed it, else the latest migration's
--   (0321 for the memory settings). A host with less memory than the pod (a
--   local compose stack) holds the same rows: work_mem is a per-node ceiling,
--   reached only by a sort or hash that large, and the local stack runs
--   work_mem 64MB server-wide with no container limit already.
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET work_mem TO ''64MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET hash_mem_multiplier TO ''2''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET max_parallel_workers_per_gather TO ''0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET jit TO ''off''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET maintenance_work_mem TO ''256MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET effective_cache_size TO ''40GB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET max_parallel_maintenance_workers TO ''0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET statement_timeout TO ''5s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET default_transaction_read_only TO ''on''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET idle_in_transaction_session_timeout TO ''10s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET "TimeZone" TO ''UTC''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET jit TO ''off''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET work_mem TO ''64MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET hash_mem_multiplier TO ''2''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET effective_cache_size TO ''40GB''', current_database()); END $$;
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
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET work_mem TO ''64MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET hash_mem_multiplier TO ''2''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET effective_cache_size TO ''40GB''', current_database()); END $$;
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
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_live_ingestor IN DATABASE %I SET statement_timeout TO ''30s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_live_ingestor IN DATABASE %I SET idle_in_transaction_session_timeout TO ''60s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET search_path TO "$user", public, topology, tiger', current_database()); END $$;
