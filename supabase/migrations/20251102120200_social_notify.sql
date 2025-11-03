-- --- Tables (if you don't already have them) -------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('like','comment','follow','system')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists idx_notifications_profile_created
  on public.notifications(profile_id, created_at desc);

-- RLS
alter table public.notifications enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='notifications' and policyname='notif_read_own'
  ) then
    create policy notif_read_own
      on public.notifications for select
      using (profile_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='notifications' and policyname='notif_update_read_own'
  ) then
    create policy notif_update_read_own
      on public.notifications for update
      using (profile_id = auth.uid())
      with check (profile_id = auth.uid());
  end if;

  -- Triggers from earlier step might already exist; keep idempotent.
end $$;

-- --- RPC: mark all read ----------------------------------------------------
create or replace function public.mark_all_notifications_read()
returns void
language plpgsql
security definer
as $$
begin
  update public.notifications
     set read_at = now()
   where profile_id = auth.uid() and read_at is null;
end;
$$;

revoke all on function public.mark_all_notifications_read() from public;
grant execute on function public.mark_all_notifications_read() to anon, authenticated;

-- Ensure realtime sees tables
alter publication supabase_realtime add table public.notifications;
