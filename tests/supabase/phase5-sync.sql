-- Apex Phase 5 (sync). Run ONCE in the Supabase dashboard: SQL Editor > New query > paste > Run.
-- It only adds one rule: the history table may hold each (account, record, version) once, so a
-- retried upload can never create duplicates. Nothing else changes and no data is touched.

-- Safe clean-up first (the table is empty today because nothing has synced yet).
delete from public.record_history a
using public.record_history b
where a.id > b.id and a.user_id = b.user_id and a.record_id = b.record_id and a.version = b.version;

create unique index if not exists record_history_unique
  on public.record_history (user_id, record_id, version);

-- Check it worked: this should return one row.
select indexname from pg_indexes where schemaname = 'public' and indexname = 'record_history_unique';
