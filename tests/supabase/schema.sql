-- Apex schema. Run once in each Supabase project (dev, then prod):
-- Dashboard > SQL Editor > New query > paste > Run.
-- The server only ever stores ciphertext. See General System Plan, section 7.

-- ---------- Tables ----------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  kdf_params jsonb not null,
  kdf_salt text not null,
  wrapped_dek text not null,
  recovery_wrapped_dek text not null,
  consent_version text not null,
  consented_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.records (
  id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  payload text not null check (octet_length(payload) <= 2000000), -- base64(iv + ciphertext)
  schema_version int not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.record_history (
  id bigserial primary key,
  record_id uuid not null,
  user_id uuid not null references auth.users on delete cascade,
  version int not null,
  payload text not null check (octet_length(payload) <= 2000000),
  saved_at timestamptz not null default now()
);

create index if not exists records_user_updated_idx on public.records (user_id, updated_at);
create index if not exists history_user_record_idx on public.record_history (user_id, record_id);

-- ---------- Triggers ----------
-- Stamp updated_at server-side and make ownership immutable.
create or replace function public.records_guard() returns trigger
language plpgsql as $$
begin
  if new.user_id <> old.user_id or new.id <> old.id then
    raise exception 'id and user_id are immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists records_guard_trg on public.records;
create trigger records_guard_trg before update on public.records
  for each row execute function public.records_guard();

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.records enable row level security;
alter table public.record_history enable row level security;

revoke all on public.profiles, public.records, public.record_history from anon;

-- profiles: owner can read, create and update their own row (no delete; account deletion cascades)
create policy profiles_select on public.profiles for select to authenticated using (user_id = auth.uid());
create policy profiles_insert on public.profiles for insert to authenticated with check (user_id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- records: owner only. Normal deletes are soft (set deleted_at); a hard delete
-- is allowed only on rows already soft-deleted (retention purge).
create policy records_select on public.records for select to authenticated using (user_id = auth.uid());
create policy records_insert on public.records for insert to authenticated with check (user_id = auth.uid());
create policy records_update on public.records for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy records_purge on public.records for delete to authenticated
  using (user_id = auth.uid() and deleted_at is not null);

-- record_history: append-only for the owner
create policy history_select on public.record_history for select to authenticated using (user_id = auth.uid());
create policy history_insert on public.record_history for insert to authenticated with check (user_id = auth.uid());

-- ---------- Storage (encrypted documents) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('vault', 'vault', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

create policy vault_select on storage.objects for select to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy vault_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy vault_update on storage.objects for update to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy vault_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
