-- Chip registry (one row per physical NFC/QR tag)
create table if not exists public.chips (
  id uuid primary key default gen_random_uuid(),
  tag_id text not null unique,          -- e.g. UID or short id encoded into QR/NFC
  public_key text,                      -- optional: if your tags support signatures
  secret text,                          -- optional: for HMAC-based tags
  counter bigint default 0 not null,    -- last accepted counter to prevent replay
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Link a chip to the artwork it authenticates
create table if not exists public.chip_artworks (
  chip_id uuid references public.chips(id) on delete cascade,
  artwork_id uuid references public.artworks(id) on delete cascade,
  primary key (chip_id, artwork_id)
);

-- Audit of scans
create table if not exists public.chip_scan_events (
  id uuid primary key default gen_random_uuid(),
  chip_id uuid references public.chips(id) on delete set null,
  artwork_id uuid references public.artworks(id) on delete set null,
  state text not null,          -- 'authentic' | 'mismatch' | 'cloned' | 'invalid'
  ip text,
  ua text,
  created_at timestamptz default now()
);

-- Keep updated_at
create trigger chips_updated_at before update on public.chips
for each row execute procedure moddatetime (updated_at);
