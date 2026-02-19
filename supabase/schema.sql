create extension if not exists pgcrypto;

create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 4000),
  sentiment text not null check (sentiment in ('positive', 'neutral', 'negative', 'reflective')),
  created_at timestamptz not null default now(),
  position jsonb not null,
  inserted_at timestamptz not null default now()
);

create index if not exists diary_entries_user_id_created_at_idx
  on public.diary_entries (user_id, created_at);

alter table public.diary_entries enable row level security;

drop policy if exists "entries_select_own" on public.diary_entries;
create policy "entries_select_own"
  on public.diary_entries
  for select
  using (auth.uid() = user_id);

drop policy if exists "entries_insert_own" on public.diary_entries;
create policy "entries_insert_own"
  on public.diary_entries
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "entries_update_own" on public.diary_entries;
create policy "entries_update_own"
  on public.diary_entries
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "entries_delete_own" on public.diary_entries;
create policy "entries_delete_own"
  on public.diary_entries
  for delete
  using (auth.uid() = user_id);
