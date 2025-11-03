-- ============================================================================
-- Social v1 (additive, safe with your existing schema)
-- Reuses: public.profiles, public.follows, public.notifications (unchanged)
-- Adds:   posts, post_media, post_likes, post_comments
-- Also:   streaks/xp/badges scaffolding (tables only; optional to use later)
-- All FKs -> profiles(id); RLS with auth.uid()
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'media_kind') then
    create type media_kind as enum ('image','video');
  end if;
end $$;

-- posts
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles(id) on delete cascade,
  caption    text,
  created_at timestamptz not null default now(),
  listing_id uuid null,
  visibility text not null default 'public' check (visibility in ('public','followers'))
);
alter table public.posts enable row level security;

create policy "posts_read_public_or_followers"
  on public.posts for select using (
    visibility = 'public'
    or author_id = auth.uid()
    or exists (
      select 1 from public.follows f
      where f.followee_id = posts.author_id and f.follower_id = auth.uid()
    )
  );
create policy "posts_insert_author" on public.posts for insert with check (author_id = auth.uid());
create policy "posts_update_author" on public.posts for update using (author_id = auth.uid());
create policy "posts_delete_author" on public.posts for delete using (author_id = auth.uid());

create index if not exists idx_posts_author_created on public.posts(author_id, created_at desc);
create index if not exists idx_posts_created on public.posts(created_at desc);

-- post_media
create table if not exists public.post_media (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  url        text not null,
  kind       media_kind not null default 'image',
  width      int,
  height     int,
  duration_s numeric,
  created_at timestamptz not null default now()
);
alter table public.post_media enable row level security;

create policy "post_media_read_via_post"
  on public.post_media for select using (
    exists (
      select 1 from public.posts p
      where p.id = post_media.post_id
        and (
          p.visibility = 'public'
          or p.author_id = auth.uid()
          or exists (
            select 1 from public.follows f
            where f.followee_id = p.author_id and f.follower_id = auth.uid()
          )
        )
    )
  );
create policy "post_media_write_post_author"
  on public.post_media for all
  using (
    exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  )
  with check (
    exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );
create index if not exists idx_post_media_post on public.post_media(post_id);

-- post_likes (separate from your artworks.likes)
create table if not exists public.post_likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);
alter table public.post_likes enable row level security;

create policy "post_likes_read_all"   on public.post_likes for select using (true);
create policy "post_likes_insert_self" on public.post_likes for insert with check (profile_id = auth.uid());
create policy "post_likes_delete_self" on public.post_likes for delete using (profile_id = auth.uid());
create index if not exists idx_post_likes_post on public.post_likes(post_id);
create index if not exists idx_post_likes_profile on public.post_likes(profile_id);

-- post_comments
create table if not exists public.post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (length(trim(body)) >= 1),
  is_helpful boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.post_comments enable row level security;

create policy "post_comments_read_via_post"
  on public.post_comments for select using (
    exists (
      select 1 from public.posts p
      where p.id = post_comments.post_id
        and (
          p.visibility = 'public'
          or p.author_id = auth.uid()
          or exists (
            select 1 from public.follows f
            where f.followee_id = p.author_id and f.follower_id = auth.uid()
          )
        )
    )
  );
create policy "post_comments_insert_self" on public.post_comments for insert with check (author_id = auth.uid());
create policy "post_comments_update_owner_or_post_author"
  on public.post_comments for update using (
    author_id = auth.uid()
    or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );
create policy "post_comments_delete_owner_or_post_author"
  on public.post_comments for delete using (
    author_id = auth.uid()
    or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );
create index if not exists idx_post_comments_post_created on public.post_comments(post_id, created_at);
create index if not exists idx_post_comments_author on public.post_comments(author_id);

-- feed view
create or replace view public.v_feed as
select
  p.*,
  (select coalesce(count(*),0) from public.post_likes    pl where pl.post_id = p.id) as like_count,
  (select coalesce(count(*),0) from public.post_comments pc where pc.post_id = p.id) as comment_count
from public.posts p
where p.visibility = 'public'
   or p.author_id = auth.uid()
   or exists (
        select 1 from public.follows f
        where f.followee_id = p.author_id and f.follower_id = auth.uid()
     )
order by p.created_at desc;

-- streaks/xp/badges scaffolding (optional)
create table if not exists public.streaks (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  last_credited_date date
);
alter table public.streaks enable row level security;
create policy "streaks_owner_all" on public.streaks for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create table if not exists public.xp_events (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('critique','post','sale','license','referral','deliver_on_time')),
  amount      int  not null default 0,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.xp_events enable row level security;
create policy "xp_events_owner_all" on public.xp_events for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create table if not exists public.badge_tiers (
  id               text primary key, -- 'bronze','silver','gold','platinum'
  min_xp           int not null,
  fee_discount_bp  int not null default 0,
  perks            jsonb not null default '{}'::jsonb
);

create table if not exists public.user_badges (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  tier_id     text not null references public.badge_tiers(id) on delete restrict,
  awarded_at  timestamptz not null default now(),
  expires_at  timestamptz,
  primary key (profile_id, tier_id)
);
alter table public.user_badges enable row level security;
create policy "user_badges_owner_read"  on public.user_badges for select using (profile_id = auth.uid());
create policy "user_badges_owner_upsert" on public.user_badges for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

insert into public.badge_tiers (id, min_xp, fee_discount_bp, perks) values
  ('bronze',   100, 200, '{"boost":"fresh_rail"}'),
  ('silver',   500, 500, '{"priority":"curated_review"}'),
  ('gold',    1500,1000, '{"pin":"homepage_queue"}')
on conflict (id) do nothing;
