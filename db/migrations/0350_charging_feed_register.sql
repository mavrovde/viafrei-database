-- The charging feed register: which feeds the charging answers read, and how.
--
-- Today's MCP server and site read the charging sites near a point with one
-- statement (CHARGING_SITES_NEAR) whose parameters come from the platform's
-- feed registry, in code: the operator and register feeds whose sites answer
-- (and, of a retired one, until when), the rank that orders their sites at
-- one place, the register feed whose sites give way to an operator's site
-- within a radius (the twin), and, per status feed, the age after which its
-- status is stale, the age a statement may have, the hours after which an
-- unchanged validator means a frozen source, and the site feed whose points
-- it reports on. viafrei-api reads the same sites and must not keep a copy of
-- that list in its own code, where it would drift; this table holds it, one
-- row per feed, seeded from the registry as the platform reads it on
-- 2026-11-25 (charging_site_params, status_feed_windows, charging_ranks,
-- status_point_pairs, site_twin_feeds and the twin radius, 50 m).
--
--   role 'site':   site_rank (lower first), twin_radius_m (the register feed
--                  whose sites give way to an operator's site that near),
--                  answers_until (a retired feed's rows answer until then;
--                  null: not retired).
--   role 'status': stale_after_s (the publisher's cadence times its
--                  freshness intervals), statement_max_age_s, frozen_after_s
--                  (null: never judged frozen), points_from (the site feed
--                  whose points the status speaks for; null: matched by id
--                  alone).
--
-- A retired status feed has no window and no row: the readers read its rows
-- as no status. The two retired site feeds keep their rank (the statement
-- ranks every row it reads) and answer until the end of their grace, which
-- was nil (2026-10-19, 00:00 Berlin).
--
-- Also granted to api_reader: feed_run_extents and feed_versions, which the
-- status liveness read (STATUS_FEED_LIVENESS) joins beside feed_runs and
-- charging_status_runs (0347), and energy_page_slugs, which the site
-- statement reads for each site's page. SELECT on each relation by name, as
-- 0336.
--
-- A main follow-up reads its own parameters from this table instead of its
-- code; until it does, a registry change is a row here in the same release.
--
-- rollback:
--   revoke select on public.energy_page_slugs, public.feed_run_extents, public.feed_versions from api_reader;
--   drop table if exists public.charging_feed_register;
--   delete from schema_migrations where version = 350;

set local lock_timeout = '5s';

create table if not exists public.charging_feed_register (
  feed_key text primary key check (btrim(feed_key) <> ''),
  source_id text not null check (btrim(source_id) <> ''),
  role text not null check (role in ('site', 'status')),
  site_rank smallint,
  twin_radius_m smallint check (twin_radius_m > 0),
  stale_after_s integer check (stale_after_s > 0),
  statement_max_age_s integer check (statement_max_age_s > 0),
  frozen_after_s integer check (frozen_after_s > 0),
  points_from text references public.charging_feed_register (feed_key),
  answers_until timestamptz,
  constraint charging_feed_register_site_check check (
    (role = 'site') = (site_rank is not null)
    and (role = 'site' or (twin_radius_m is null and answers_until is null))),
  constraint charging_feed_register_status_check check (
    (role = 'status') = (stale_after_s is not null and statement_max_age_s is not null)
    and (role = 'status' or (frozen_after_s is null and points_from is null)))
);

comment on table public.charging_feed_register is 'The charging feeds the charging answers read, one row per feed: a site feed''s rank, twin radius and end of answering, a status feed''s age limits and the site feed whose points it speaks for (0350). Seeded from the platform''s feed registry; a registry change is a row here.';

insert into public.charging_feed_register
  (feed_key, source_id, role, site_rank, twin_radius_m, stale_after_s, statement_max_age_s, frozen_after_s, points_from, answers_until)
values
  ('afir_eliso_stat', 'mobilithek_afir_eliso_stat', 'site', 9, null, null, null, null, null, null),
  ('afir_enbw_stat', 'mobilithek_afir_enbw_stat', 'site', 10, null, null, null, null, null, null),
  ('afir_tesla_stat', 'mobilithek_afir_tesla_stat', 'site', 11, null, null, null, null, null, null),
  ('afir_vw_stat', 'mobilithek_afir_vw_stat', 'site', 12, null, null, null, null, null, null),
  ('afir_pump_stat', 'mobilithek_afir_pump_stat', 'site', 13, null, null, null, null, null, null),
  ('afir_edri_stat', 'mobilithek_afir_edri_stat', 'site', 14, null, null, null, null, null, null),
  ('afir_audi_stat', 'mobilithek_afir_audi_stat', 'site', 15, null, null, null, null, null, null),
  ('afir_enio_stat', 'mobilithek_afir_enio_stat', 'site', 16, null, null, null, null, null, null),
  ('afir_evprice_stat', 'mobilithek_afir_evprice_stat', 'site', 17, null, null, null, null, null, null),
  ('afir_ewe_stat', 'mobilithek_afir_ewe_stat', 'site', 18, null, null, null, null, null, null),
  ('afir_gls_stat', 'mobilithek_afir_gls_stat', 'site', 19, null, null, null, null, null, null),
  ('afir_gpjoule_stat', 'mobilithek_afir_gpjoule_stat', 'site', 20, null, null, null, null, null, null),
  ('afir_gridco_stat', 'mobilithek_afir_gridco_stat', 'site', 21, null, null, null, null, null, null),
  ('afir_elu_stat', 'mobilithek_afir_elu_stat', 'site', 22, null, null, null, null, null, null),
  ('afir_eround_stat', 'mobilithek_afir_eround_stat', 'site', 23, null, null, null, null, null, null),
  ('afir_inergia_stat', 'mobilithek_afir_inergia_stat', 'site', 24, null, null, null, null, null, null),
  ('afir_rudnick_stat', 'mobilithek_afir_rudnick_stat', 'site', 25, null, null, null, null, null, null),
  ('afir_lichtblick_stat', 'mobilithek_afir_lichtblick_stat', 'site', 26, null, null, null, null, null, null),
  ('afir_monta_stat', 'mobilithek_afir_monta_stat', 'site', 27, null, null, null, null, null, null),
  ('afir_qwello_stat', 'mobilithek_afir_qwello_stat', 'site', 28, null, null, null, null, null, null),
  ('afir_road_stat', 'mobilithek_afir_road_stat', 'site', 29, null, null, null, null, null, null),
  ('afir_smatrics_stat', 'mobilithek_afir_smatrics_stat', 'site', 30, null, null, null, null, null, null),
  ('afir_wirelane_stat', 'mobilithek_afir_wirelane_stat', 'site', 31, null, null, null, null, null, null),
  ('afir_chargecloud_stat', 'mobilithek_afir_chargecloud_stat', 'site', 32, null, null, null, null, null, null),
  ('afir_vaylens_stat', 'mobilithek_afir_vaylens_stat', 'site', 33, null, null, null, null, null, null),
  ('afir_eclearing_stat', 'mobilithek_afir_eclearing_stat', 'site', 34, null, null, null, null, null, null),
  ('afir_ladenetz_stat', 'mobilithek_afir_ladenetz_stat', 'site', 35, null, null, null, null, null, '2026-10-19 00:00 Europe/Berlin'),
  ('afir_ladebusiness_stat', 'mobilithek_afir_ladebusiness_stat', 'site', 36, null, null, null, null, null, '2026-10-19 00:00 Europe/Berlin'),
  ('afir_tcbackend_stat', 'mobilithek_afir_tcbackend_stat', 'site', 37, null, null, null, null, null, null),
  ('afir_chargepool_stat', 'mobilithek_afir_chargepool', 'site', 38, null, null, null, null, null, null),
  ('afir_ecomovement', 'mobilithek_afir_ecomovement', 'site', 39, null, null, null, null, null, null),
  ('ocpdb_chargecloud_stat', 'ocpdb_chargecloud', 'site', 40, null, null, null, null, null, null),
  ('ocpdb_taubert_stat', 'ocpdb_taubert', 'site', 42, null, null, null, null, null, null),
  ('bnetza_lsr', 'bnetza_lsr', 'site', 90, 50, null, null, null, null, null),
  ('afir_tesla_dyn', 'mobilithek_afir_tesla_dyn', 'status', null, null, 2700, 1800, 86400, null, null),
  ('afir_vw_dyn', 'mobilithek_afir_vw_dyn', 'status', null, null, 32400, 1800, 86400, null, null),
  ('afir_enbw_dyn', 'mobilithek_afir_enbw_dyn', 'status', null, null, 2700, 1800, 86400, null, null),
  ('afir_ecomovement_dyn', 'mobilithek_afir_ecomovement_dyn', 'status', null, null, 2700, 1800, 86400, 'afir_ecomovement', null),
  ('afir_eclearing_dyn', 'mobilithek_afir_eclearing_dyn', 'status', null, null, 2700, 1800, 86400, 'afir_eclearing_stat', null),
  ('afir_edri_dyn', 'mobilithek_afir_edri_dyn', 'status', null, null, 2700, 1800, 86400, null, null),
  ('afir_audi_dyn', 'mobilithek_afir_audi_dyn', 'status', null, null, 32400, 1800, 86400, null, null),
  ('afir_enerando_dyn', 'mobilithek_afir_enerando_dyn', 'status', null, null, 2700, 1800, 86400, null, null),
  ('afir_enio_dyn', 'mobilithek_afir_enio_dyn', 'status', null, null, 10800, 1800, 86400, null, null),
  ('afir_evprice_dyn', 'mobilithek_afir_evprice_dyn', 'status', null, null, 2700, 1800, 86400, 'afir_evprice_stat', null),
  ('afir_ewe_dyn', 'mobilithek_afir_ewe_dyn', 'status', null, null, 2700, 1800, 86400, 'afir_ewe_stat', null),
  ('afir_gls_dyn', 'mobilithek_afir_gls_dyn', 'status', null, null, 10800, 1800, 86400, 'afir_gls_stat', null),
  ('afir_gpjoule_dyn', 'mobilithek_afir_gpjoule_dyn', 'status', null, null, 2700, 1800, 86400, 'afir_gpjoule_stat', null),
  ('afir_gridco_dyn', 'mobilithek_afir_gridco_dyn', 'status', null, null, 2700, 1800, 86400, 'afir_gridco_stat', null),
  ('afir_eround_dyn', 'mobilithek_afir_eround_dyn', 'status', null, null, 2700, 1800, 86400, 'afir_eround_stat', null),
  ('afir_inergia_dyn', 'mobilithek_afir_inergia_dyn', 'status', null, null, 32400, 1800, 86400, 'afir_inergia_stat', null),
  ('afir_lichtblick_dyn', 'mobilithek_afir_lichtblick_dyn', 'status', null, null, 2700, 1800, 86400, 'afir_lichtblick_stat', null),
  ('afir_monta_dyn', 'mobilithek_afir_monta_dyn', 'status', null, null, 2700, 1800, 86400, null, null),
  ('afir_qwello_dyn', 'mobilithek_afir_qwello_dyn', 'status', null, null, 2700, 1800, 86400, 'afir_qwello_stat', null),
  ('afir_road_dyn', 'mobilithek_afir_road_dyn', 'status', null, null, 2700, 1800, 86400, 'afir_road_stat', null),
  ('afir_smatrics_dyn', 'mobilithek_afir_smatrics_dyn', 'status', null, null, 2700, 1800, 86400, 'afir_smatrics_stat', null),
  ('afir_wirelane_dyn', 'mobilithek_afir_wirelane_dyn', 'status', null, null, 2700, 1800, 86400, 'afir_wirelane_stat', null),
  ('afir_chargecloud_dyn', 'mobilithek_afir_chargecloud_dyn', 'status', null, null, 2700, 1800, 86400, null, null),
  ('afir_vaylens_dyn', 'mobilithek_afir_vaylens_dyn', 'status', null, null, 2700, 1800, 86400, 'afir_vaylens_stat', null),
  ('afir_tcbackend_dyn', 'mobilithek_afir_tcbackend_dyn', 'status', null, null, 2700, 1800, 86400, 'afir_tcbackend_stat', null),
  ('afir_elu_dyn', 'mobilithek_afir_elu_dyn', 'status', null, null, 4500, 1800, 86400, null, null),
  ('afir_chargepool_dyn', 'mobilithek_afir_chargepool', 'status', null, null, 2700, 1800, 86400, 'afir_chargepool_stat', null),
  ('afir_eliso_dyn', 'mobilithek_afir_eliso_dyn', 'status', null, null, 2700, 1800, 86400, 'afir_eliso_stat', null),
  ('ocpdb_chargecloud_dyn', 'ocpdb_chargecloud', 'status', null, null, 180, 1800, null, 'ocpdb_chargecloud_stat', null),
  ('ocpdb_taubert_dyn', 'ocpdb_taubert', 'status', null, null, 180, 1800, null, 'ocpdb_taubert_stat', null),
  ('hh_emobility_dyn', 'hh_emobility', 'status', null, null, 900, 1800, null, null, null)
on conflict (feed_key) do nothing;

grant select on public.charging_feed_register to api_reader;
grant select on public.energy_page_slugs to api_reader;
grant select on public.feed_run_extents to api_reader;
grant select on public.feed_versions to api_reader;
