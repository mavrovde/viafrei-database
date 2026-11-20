-- The owner's and the two readers' memory settings in this database, sized for
-- the production database pod (40 GiB memory, shared_buffers 10 GB) instead
-- of the 1.5 GB compose container the baseline's values were sized for:
--   viafrei_digest, viafrei_mcp: work_mem 16MB -> 64MB;
--   viafrei (the owner, the role the ingest writers use): work_mem 16MB -> 32MB;
--   all three: hash_mem_multiplier 1.0 -> 2, effective_cache_size 40GB (none before);
--   the owner: maintenance_work_mem 64MB -> 256MB.
-- Production was given these values by hand on 2026-11-19 (role settings IN
-- DATABASE, the rows that take precedence), the owner's work_mem at 64MB,
-- lowered to 32MB by the owner the same night so the memory bound fits; the
-- deploy re-applies db/roles/settings.sql on every run, which set them back
-- to the old values.
-- settings.sql carries these values in place of the baseline's (one statement
-- per setting), so a re-run now sets these values. The memory bound in settings.sql is re-derived for the
-- pod's headroom (test/memory-bound.test.ts).
--
-- effective_cache_size is a planner estimate, not an allocation. Set per role
-- in this database, it takes precedence over the server's command line.
--
-- rollback:
--   the baseline's values: work_mem 16MB, hash_mem_multiplier 1.0 for the three
--   roles, maintenance_work_mem 64MB for the owner, and
--   alter role <role> in database <db> reset effective_cache_size;
--   then the same values back in db/roles/settings.sql;
--   delete from schema_migrations where version = 321;

set local lock_timeout = '5s';

DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET work_mem TO ''32MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET hash_mem_multiplier TO ''2''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET maintenance_work_mem TO ''256MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET effective_cache_size TO ''40GB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET work_mem TO ''64MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET hash_mem_multiplier TO ''2''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET effective_cache_size TO ''40GB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET work_mem TO ''64MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET hash_mem_multiplier TO ''2''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET effective_cache_size TO ''40GB''', current_database()); END $$;
