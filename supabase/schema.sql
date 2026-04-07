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

create table if not exists public.reminder_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null,
  enabled boolean not null default true,
  reminder_times time[] not null default '{09:00,14:00,20:00}'::time[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_enabled_idx
  on public.push_subscriptions (user_id, enabled);

create table if not exists public.reminder_dispatch_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  slot_time time not null,
  channel text not null check (channel in ('in_app', 'web_push')),
  status text not null check (status in ('sent', 'skipped_done', 'skipped_no_permission', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  unique (user_id, local_date, slot_time, channel)
);

alter table public.reminder_settings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminder_dispatch_log enable row level security;

drop policy if exists "reminder_settings_select_own" on public.reminder_settings;
create policy "reminder_settings_select_own"
  on public.reminder_settings
  for select
  using (auth.uid() = user_id);

drop policy if exists "reminder_settings_insert_own" on public.reminder_settings;
create policy "reminder_settings_insert_own"
  on public.reminder_settings
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "reminder_settings_update_own" on public.reminder_settings;
create policy "reminder_settings_update_own"
  on public.reminder_settings
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own"
  on public.push_subscriptions
  for select
  using (auth.uid() = user_id);

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own"
  on public.push_subscriptions
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own"
  on public.push_subscriptions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own"
  on public.push_subscriptions
  for delete
  using (auth.uid() = user_id);
