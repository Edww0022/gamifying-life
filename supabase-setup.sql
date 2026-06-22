-- Run this file in Supabase -> SQL Editor -> New query.
create table if not exists public.game_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.game_states enable row level security;

drop policy if exists "Users can read their own game" on public.game_states;
drop policy if exists "Users can create their own game" on public.game_states;
drop policy if exists "Users can update their own game" on public.game_states;

create policy "Users can read their own game" on public.game_states
for select to authenticated using ((select auth.uid()) = user_id);

create policy "Users can create their own game" on public.game_states
for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Users can update their own game" on public.game_states
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
