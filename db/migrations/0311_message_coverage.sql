-- Which message sources let the motorway lamp say a Land's police and Land
-- traffic messages are seen (#29): each Land's own message feeds (coverage
-- role own) and the NMS relay that carries every Land's Landesmeldestelle
-- (carried), as measured on production on 2026-10-21. An own feed shown only
-- while it is current (current_only: the LMS Baden-Wuerttemberg) caps its
-- Land's sight. The platform's lamp holds the same table in code;
-- contract.message_coverage publishes it (0312). A change is a new migration.
--
-- rollback: drop table public.message_coverage_sources;
--   delete from schema_migrations where version = 311;

create table public.message_coverage_sources (
    state_code    text not null check (state_code ~ '^[0-9]{2}$'),
    source_ref    text not null check (btrim(source_ref) <> ''),
    coverage_role text not null check (coverage_role in ('own', 'carried')),
    current_only  boolean not null default false,
    measured_on   date,
    primary key (state_code, source_ref),
    check (not current_only or coverage_role = 'own'),
    check (coverage_role = 'own' or measured_on is not null)
);
comment on table public.message_coverage_sources is 'Per Land, the message feeds that make its traffic messages seen: own feeds and the measured NMS relay (0311).';

insert into public.message_coverage_sources (state_code, source_ref, coverage_role, current_only, measured_on) values
  ('01', 'traffic_sh', 'own', false, null),
  ('01', 'nms_events', 'carried', false, '2026-10-21'::date),
  ('02', 'nms_events', 'carried', false, '2026-10-21'::date),
  ('03', 'nms_events', 'carried', false, '2026-10-21'::date),
  ('04', 'nms_events', 'carried', false, '2026-10-21'::date),
  ('05', 'nms_events', 'carried', false, '2026-10-21'::date),
  ('06', 'nms_events', 'carried', false, '2026-10-21'::date),
  ('07', 'nms_events', 'carried', false, '2026-10-21'::date),
  ('08', 'traffic_bw', 'own', true, null),
  ('08', 'nms_events', 'carried', false, '2026-10-21'::date),
  ('09', 'nms_events', 'carried', false, '2026-10-21'::date),
  ('10', 'nms_events', 'carried', false, '2026-10-21'::date),
  ('11', 'traffic_lms_berlin', 'own', false, null),
  ('11', 'nms_events', 'carried', false, '2026-10-21'::date),
  ('12', 'nms_events', 'carried', false, '2026-10-21'::date),
  ('13', 'nms_events', 'carried', false, '2026-10-21'::date),
  ('14', 'nms_events', 'carried', false, '2026-10-21'::date),
  ('15', 'nms_events', 'carried', false, '2026-10-21'::date),
  ('16', 'nms_events', 'carried', false, '2026-10-21'::date);
