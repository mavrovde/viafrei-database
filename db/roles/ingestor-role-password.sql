-- Sets the password of the viafrei_ingestor role. The role itself, its grants and
-- its connection settings are created by the migrations; this file only gives
-- it a password, and is safe to run on every start (idempotent).
--
-- The service sends this file to psql with ONE line in front of it,
--     \set pw <value>
-- read from the mounted secret file named viafrei_ingestor. The value is never a
-- command-line argument and never logged by the service; psql quotes it
-- (:'pw' below). The three settings switch statement logging off for this
-- session, so a slow-statement or error log cannot capture the value.
set log_min_duration_statement = -1;
set log_min_error_statement = panic;
set log_statement = 'none';
alter role viafrei_ingestor password :'pw';
