/**
 * The schema behaviour mutants (#32): functions, triggers and views. Each one
 * plants a small, plausible fault in the baseline (or a migration) and names
 * the database test that must fail on it. Run by scripts/mutate.ts; a mutant
 * whose `from` text is not found is counted as surviving, and every `from` is
 * unique in its file (test/mutants-schema-behaviour.test.ts).
 */
import { join } from "node:path";

export type SchemaMutant = { readonly name: string; readonly from: string; readonly to: string; readonly file: string; readonly tests: readonly string[] };

const ROOT = join(import.meta.dirname, "..");
export const BASELINE = join(ROOT, "db", "baseline", "0293_baseline.sql");

const CONTROL = ["test/control-plane.db.test.ts"];

const control: SchemaMutant[] = [
  { name: "control: admit lets a caller past its cap", from: "    elsif mine >= my_cap then\n        count_hit := 'share';", to: "    elsif mine > my_cap then\n        count_hit := 'share';" },
  { name: "control: admit ignores the others' unmet floors", from: "elsif total + reserved >= b.ceiling then", to: "elsif total + reserved > b.ceiling + 1000 then" },
  { name: "control: admit lets the key past its ceiling", from: "if total >= b.ceiling then\n        count_hit := 'ceiling';", to: "if total > b.ceiling then\n        count_hit := 'ceiling';" },
  { name: "control: admit lets a burst past its maximum", from: "and burst >= b.burst_max then", to: "and burst > b.burst_max then" },
  { name: "control: admit lets the MCP role name a worker's share", from: "and coalesce(nullif(current_setting('role', true), 'none'), session_user::text) = 'viafrei_mcp' then", to: "and false then" },
  { name: "control: admit ignores the spacing", from: "and s.last_admitted_at > t - sp then", to: "and s.last_admitted_at > t then" },
  { name: "control: admit never sets the owed mark", from: "update control.budget_state set owed_by = p_caller, owed_at = t where budget_key = k;", to: "perform 1;" },
  { name: "control: admit's person stamp never makes the background yield", from: "and s.person_wanted_at > t - 2 * sp then", to: "and s.person_wanted_at > t then" },
  { name: "control: admit records the wrong outcome in its refusal row", from: "    values (t, k, p_provider, p_caller, p_subject, hit,", to: "    values (t, k, p_provider, p_caller, p_subject, 'share'," },
  { name: "control: admit's owed mark is not cleared by its owner", from: "owed_by = case when owed_by = p_caller then null else owed_by end", to: "owed_by = owed_by" },
  { name: "control: hold holds a key without a hold", from: "if k is null or hs = 0 then\n    return null;", to: "if k is null then\n    return null;" },
  { name: "control: hold takes any reason", from: "if p_reason is null or p_reason not in ('429', '5xx', 'owner') then", to: "if p_reason is null then" },
  { name: "control: hold shortens a hold in force", from: "set held_until = greatest(coalesce(held_until, clock_timestamp()), clock_timestamp() + make_interval(secs => hs)),", to: "set held_until = clock_timestamp() + make_interval(secs => hs)," },
  { name: "control: release hands back more than was admitted", from: "and bucket_start = to_timestamp(p_token::bigint) and not_sent < admitted;", to: "and bucket_start = to_timestamp(p_token::bigint);" },
  { name: "control: want stamps a key without spacing", from: "   where p.provider = p_provider and b.spacing_ms is not null;", to: "   where p.provider = p_provider;" },
  { name: "control: bucket_width is the window, not a minute of it", from: "coalesce(p_burst_window_s, p_window_s)) / 60) $$;", to: "coalesce(p_burst_window_s, p_window_s)) / 1) $$;" },
  { name: "control: set_budget takes a ceiling above the licence", from: "      if v > b.licence_max then", to: "      if v > b.licence_max + 1 then" },
  { name: "control: set_budget does not fit the caps to a lowered ceiling", from: "      update control.budgets set ceiling = v where budget_key = p_budget_key;\n      perform control.fit_shares(p_budget_key);", to: "      update control.budgets set ceiling = v where budget_key = p_budget_key;" },
  { name: "control: set_budget keeps the floor of a door switched off", from: "floor = case when v = 0 then 0 when floor < 1 then 1 else floor end", to: "floor = case when floor < 1 then 1 else floor end" },
  { name: "control: set_budget takes a spacing faster than the licence", from: "      if v < b.spacing_licence_ms then", to: "      if v < b.spacing_licence_ms - 1 then" },
  { name: "control: set_budget takes a cap below the floor", from: "      if v < sh.floor and v > 0 then", to: "      if v < sh.floor and v > 1 then" },
  { name: "control: set_budget takes a floor above the cap", from: "      if v > sh.cap then", to: "      if v > sh.cap + 1 then" },
  { name: "control: set_budget takes a fraction", from: "    if p_value <> trunc(p_value) or p_value > 2000000000 then", to: "    if p_value > 2000000000 then" },
  { name: "control: fit_shares gives no floor to a caller without one", from: "update control.shares sh set floor = 1 where sh.budget_key = p_budget_key and sh.floor < 1 and sh.cap > 0;", to: "perform 1;" },
  { name: "control: fit_shares lets a ceiling below its callers through", from: "  if c < n then\n    raise exception 'control.fit_shares", to: "  if c < 0 then\n    raise exception 'control.fit_shares" },
  { name: "control: fit_shares keeps floors that no longer fit", from: "update control.shares sh set floor = 1 where sh.budget_key = p_budget_key and sh.floor > 1 and sh.cap > 0;", to: "perform 1;" },
  { name: "control: the shape takes a cap over the ceiling", from: "  if mx > ceil_ then", to: "  if mx > ceil_ + 100 then" },
  { name: "control: the shape takes floors over the ceiling", from: "  if fl > ceil_ then", to: "  if fl > ceil_ + 100 then" },
  { name: "control: the shape takes a caller without a floor", from: "where sh.budget_key = k and sh.floor < 1 and sh.cap > 0 order by sh.caller limit 1;", to: "where false order by sh.caller limit 1;" },
  { name: "control: the shape takes a cap that eats the others' floors", from: "where sh.budget_key = k and sh.cap > ceil_ - (fl - sh.floor) order by sh.caller limit 1;", to: "where false order by sh.caller limit 1;" },
  { name: "control: the budget shape trigger watches another column", from: "CREATE CONSTRAINT TRIGGER budgets_shape AFTER UPDATE OF ceiling ON", to: "CREATE CONSTRAINT TRIGGER budgets_shape AFTER UPDATE OF window_s ON" },
  { name: "control: the shares shape trigger misses an insert", from: "CREATE CONSTRAINT TRIGGER shares_shape AFTER INSERT OR DELETE OR UPDATE ON", to: "CREATE CONSTRAINT TRIGGER shares_shape AFTER DELETE OR UPDATE ON" },
  { name: "control: audit_change takes a change without a reason", from: "  if why is null then\n    raise exception 'control.%: a change needs a reason", to: "  if false then\n    raise exception 'control.%: a change needs a reason" },
  { name: "control: audit_change records unchanged fields", from: "      if (o -> f) is distinct from (n -> f) then", to: "      if true then" },
  { name: "control: audit_change forgets the actor", from: "who text := coalesce(nullif(current_setting('viafrei.actor', true), ''), current_user);", to: "who text := current_user;" },
  { name: "control: the callers audit trigger is gone", from: "CREATE TRIGGER callers_audit AFTER INSERT OR DELETE OR UPDATE ON control.callers", to: "CREATE TRIGGER callers_audit AFTER DELETE ON control.callers" },
  { name: "control: the shares audit trigger misses an update", from: "CREATE TRIGGER shares_audit AFTER INSERT OR DELETE OR UPDATE ON control.shares", to: "CREATE TRIGGER shares_audit AFTER INSERT OR DELETE ON control.shares" },
  { name: "control: changes may be deleted", from: "CREATE TRIGGER changes_append_only BEFORE DELETE OR UPDATE ON control.changes", to: "CREATE TRIGGER changes_append_only BEFORE UPDATE ON control.changes" },
  { name: "control: changes_append_only lets the row through", from: "  raise exception 'control.changes is append-only: % refused'", to: "  return null; raise exception 'control.changes is append-only: % refused'" },
  { name: "control: the audit trigger is skipped under replica", from: "ALTER TABLE control.budgets ENABLE ALWAYS TRIGGER budgets_audit;", to: "" },
  { name: "control: publish_terms raises a lowered ceiling back", from: "         ceiling            = least(t.ceiling, excluded.licence_max),", to: "         ceiling            = excluded.licence_max," },
  { name: "control: publish_terms does not fit the keys", from: "  perform control.fit_shares(b.budget_key) from control.budgets b order by b.budget_key;", to: "" },
  { name: "control: publish_terms takes an empty declaration", from: "     or jsonb_typeof(p -> 'callers') is distinct from 'array' or jsonb_array_length(p -> 'callers') = 0 then", to: "     or false then" },
  { name: "control: publish_terms makes no budget state", from: "  insert into control.budget_state (budget_key)\n  select x ->> 'budget_key' from jsonb_array_elements(p -> 'budgets') x", to: "  insert into control.budget_state (budget_key)\n  select x ->> 'budget_key' from jsonb_array_elements(p -> 'budgets') x where false" },
  { name: "control: rollup_refresh counts a share refusal as a ceiling", from: "         count(*) filter (where x.outcome = 'share')::integer,", to: "         count(*) filter (where x.outcome = 'ceiling')::integer," },
  { name: "control: rollup_refresh keeps usage past 48 h", from: "delete from control.usage where bucket_start < now() - interval '48 hours';", to: "delete from control.usage where bucket_start < now() - interval '49 hours';" },
  { name: "control: rollup_refresh keeps refusals past 14 days", from: "delete from control.refusals where at < now() - interval '14 days';", to: "delete from control.refusals where at < now() - interval '15 days';" },
  { name: "control: rollup_refresh deletes the hourly rollup at 89 days", from: "delete from control.usage_hourly where hour < now() - interval '90 days';", to: "delete from control.usage_hourly where hour < now() - interval '88 days';" },
].map((m) => ({ ...m, file: BASELINE, tests: CONTROL }));

export const SCHEMA_BEHAVIOUR_MUTANTS: readonly SchemaMutant[] = [...control];
