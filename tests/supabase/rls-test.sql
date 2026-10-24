-- Phase 0 acceptance test: two accounts cannot see or touch each other's data.
-- Run in the DEV project's SQL Editor AFTER schema.sql. Everything is rolled
-- back at the end, so it leaves no data behind. Success = the final notice
-- says "RLS isolation: ALL CHECKS PASSED". Any failure raises an error.
begin;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@apex-test.local'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@apex-test.local');

do $$
declare
  ua constant text := 'aaaaaaaa-0000-0000-0000-00000000000a';
  ub constant text := 'bbbbbbbb-0000-0000-0000-00000000000b';
  rid constant uuid := '11111111-1111-1111-1111-111111111111';
  n int;
begin
  -- Act as A: create a record
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into records (id, user_id, payload, schema_version) values (rid, ua::uuid, 'ciphertext-a', 1);
  select count(*) into n from records;
  assert n = 1, 'A should see own record';

  -- Act as B
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  select count(*) into n from records;
  assert n = 0, 'B must not see A records';

  update records set payload = 'tampered' where id = rid;
  get diagnostics n = row_count;
  assert n = 0, 'B must not update A records';

  delete from records where id = rid;
  get diagnostics n = row_count;
  assert n = 0, 'B must not delete A records';

  begin
    insert into records (id, user_id, payload, schema_version)
    values ('22222222-2222-2222-2222-222222222222', ua::uuid, 'forged', 1);
    raise exception 'B inserted a row owned by A';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- A hard delete of a live (not soft-deleted) record must be refused even for the owner
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  delete from records where id = rid;
  get diagnostics n = row_count;
  assert n = 0, 'Hard delete of a live record must be blocked';

  -- Anonymous role sees nothing
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform 1 from records;
    raise exception 'anon could query records';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  raise notice 'RLS isolation: ALL CHECKS PASSED';
end $$;

rollback;
