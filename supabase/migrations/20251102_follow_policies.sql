-- 20251102_follow_policies.sql

-- Safety: ensure RLS is enabled
alter table public.follows enable row level security;

-- Clean old policies if they exist
drop policy if exists "follows: read all" on public.follows;
drop policy if exists "follows: user can follow" on public.follows;
drop policy if exists "follows: user can unfollow own" on public.follows;

-- Anyone (even anon) can read follows for counts/profile UIs
create policy "follows: read all"
on public.follows
for select
using (true);

-- Only the signed-in user can create a follow from themselves → others
create policy "follows: user can follow"
on public.follows
for insert
to authenticated
with check (
  follower_id = auth.uid()
  and followee_id is not null
  and follower_id <> followee_id
);

-- Only the follower can delete their own follow edge (unfollow)
create policy "follows: user can unfollow own"
on public.follows
for delete
to authenticated
using (follower_id = auth.uid());

-- Optional: ensure uniqueness & speed (skip if you already have PK/unique)
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='follows_follower_idx'
  ) then
    create index follows_follower_idx on public.follows(follower_id);
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='follows_followee_idx'
  ) then
    create index follows_followee_idx on public.follows(followee_id);
  end if;
end$$;
