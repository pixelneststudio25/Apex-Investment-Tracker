-- Phase 8 check: is the private "vault" bucket set up the way documents need it? Read-only: it changes nothing.
-- Run it in the Supabase SQL editor. Every row should say ok = true. If the bucket row is missing, run the
-- "Storage (encrypted documents)" part of tests/supabase/schema.sql again (it is safe to repeat).

select 'bucket exists, private, 10 MB limit' as check,
       exists (select 1 from storage.buckets where id = 'vault' and public = false and file_size_limit = 10485760) as ok;

select p.policyname as check, true as ok
from pg_policies p
where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname like 'vault\_%'
order by p.policyname;

select 'four vault policies (select, insert, update, delete)' as check,
       (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'vault\_%') = 4 as ok;
