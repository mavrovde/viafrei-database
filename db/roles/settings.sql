-- The role settings of this schema, scoped to the database being migrated:
-- what the baseline (and any migration after it) sets with
-- ALTER ROLE ... IN DATABASE. Settings are held per (role, database) in
-- pg_db_role_setting, so a database made as a copy of another
-- (CREATE DATABASE ... TEMPLATE) has NONE of them, and `migrate` finds nothing
-- pending there. `migrate` therefore applies this file after every successful
-- run, and `roles settings` applies it alone. Idempotent: each statement sets
-- the value it names. test/consumer.db.test.ts holds it equal to the
-- baseline's own statements and to every later migration's.
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
