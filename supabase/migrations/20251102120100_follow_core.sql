-- 1) Uniqueness + helpful indexes
alter table public.follows
  add constraint if not exists uq_follows unique (follower_id, followee_id);

create index if not exists idx_follows_follower on public.follows (follower_id);
create index if not exists idx_follows_followee on public.follows (followee_id);

-- 2) RLS (read your own + public counts)
-- Ensure table has RLS on (you likely already enabled)
alter table public.follows enable row level security;

-- Select: you can see rows where you are follower or followee
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='follows' and policyname='follows_read_self'
  ) then
    create policy follows_read_self
      on public.follows for select
      using (follower_id = auth.uid() or followee_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='follows' and policyname='follows_insert_self'
  ) then
    create policy follows_insert_self
      on public.follows for insert
      with check (follower_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='follows' and policyname='follows_delete_self'
  ) then
    create policy follows_delete_self
      on public.follows for delete
      using (follower_id = auth.uid());
  end if;
end $$;

-- 3) RPC: toggle follow
create or replace function public.toggle_follow(p_followee uuid)
returns jsonb
language plpgsql
security definer
as $$
declare me uuid := auth.uid();
declare existed boolean;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if p_followee = me then
    return jsonb_build_object('status','noop','following',false);
  end if;

  select exists(
    select 1 from public.follows where follower_id = me and followee_id = p_followee
  ) into existed;

  if existed then
    delete from public.follows where follower_id = me and followee_id = p_followee;
    return jsonb_build_object('status','unfollowed','following',false);
  else
    insert into public.follows (follower_id, followee_id) values (me, p_followee)
    on conflict do nothing;
    return jsonb_build_object('status','followed','following',true);
  end if;
end;
$$;

revoke all on function public.toggle_follow(uuid) from public;
grant execute on function public.toggle_follow(uuid) to anon, authenticated;

-- 4) Notification on follow (skip self)
create or replace function public.notify_follow() returns trigger as $$
begin
  if new.follower_id <> new.followee_id then
    insert into public.notifications (profile_id, kind, payload)
    values (new.followee_id, 'follow',
            jsonb_build_object('by', new.follower_id));
  end if;
  return new;
end; $$ language plpgsql security definer;

drop trigger if exists trg_notify_follow on public.follows;
create trigger trg_notify_follow after insert on public.follows
for each row execute function public.notify_follow();

-- Make sure realtime includes notifications (already done earlier, safe to re-run)
alter publication supabase_realtime add table public.notifications;
