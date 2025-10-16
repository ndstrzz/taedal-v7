-- === BUY NOW (MVP) ===========================================================
-- Creates an order, moves ownership, ends the listing, and records provenance.
-- Assumes:
--   - listings.type = 'fixed_price'
--   - listings.status = 'active'
--   - artworks.royalty_bps exists
--   - platform_config.platform_fee_bps exists (id = true)
--   - payout_splits.recipient_type accepts: 'seller','creator_royalty','platform_fee','charity'

create or replace function public.buy_fixed_price(
  p_listing_id uuid,
  p_quantity integer default 1
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing        public.listings%rowtype;
  v_artwork        public.artworks%rowtype;
  v_buyer_id       uuid := auth.uid();
  v_platform_bps   integer := 0;
  v_royalty_bps    integer := 0;
  v_total          numeric;
  v_platform_fee   numeric := 0;
  v_royalty_amt    numeric := 0;
  v_charity_amt    numeric := 0;
  v_seller_take    numeric := 0;
  v_order          public.orders%rowtype;
begin
  if v_buyer_id is null then
    raise exception 'Unauthorized';
  end if;

  -- lock listing row
  select * into v_listing
  from public.listings
  where id = p_listing_id
  for update;

  if not found then
    raise exception 'Listing not found';
  end if;

  if v_listing.status <> 'active' then
    raise exception 'Listing is not active';
  end if;

  if v_listing.type <> 'fixed_price' then
    raise exception 'Only fixed_price listings supported in this RPC';
  end if;

  if coalesce(p_quantity, 1) <= 0 then
    raise exception 'Quantity must be > 0';
  end if;

  -- (ERC-721 MVP) only quantity 1
  if p_quantity <> 1 then
    raise exception 'Quantity must be 1 for ERC-721 MVP';
  end if;

  if v_listing.seller_id = v_buyer_id then
    raise exception 'You cannot buy your own listing';
  end if;

  select * into v_artwork
  from public.artworks
  where id = v_listing.artwork_id;

  if not found then
    raise exception 'Artwork not found';
  end if;

  -- fees
  select platform_fee_bps into v_platform_bps
  from public.platform_config
  where id = true;

  v_royalty_bps := coalesce(v_artwork.royalty_bps, 0);

  v_total := coalesce(v_listing.fixed_price, 0) * p_quantity;
  if v_total <= 0 then
    raise exception 'Listing has no price';
  end if;

  v_platform_fee := round(v_total * v_platform_bps / 10000.0, 8);
  v_royalty_amt  := round(v_total * v_royalty_bps / 10000.0, 8);

  if coalesce(v_listing.charity_flag, false) then
    v_charity_amt := round(v_total * coalesce(v_listing.charity_pct_bps,0) / 10000.0, 8);
  end if;

  v_seller_take := v_total - v_platform_fee - v_royalty_amt - v_charity_amt;

  -- create order (treat as already paid for MVP)
  insert into public.orders(
    listing_id, buyer_id, seller_id, artwork_id, quantity,
    total_amount, currency, kind, payment_status, delivery_status,
    chain_id, tx_hash
  )
  values (
    v_listing.id, v_buyer_id, v_listing.seller_id, v_listing.artwork_id, p_quantity,
    v_total, v_listing.sale_currency, 'fixed_price', 'paid', 'transferred',
    null, null
  )
  returning * into v_order;

  -- payout splits
  if v_platform_fee > 0 then
    insert into public.payout_splits(order_id, recipient_type, amount, currency)
    values (v_order.id, 'platform_fee', v_platform_fee, v_listing.sale_currency);
  end if;

  if v_royalty_amt > 0 then
    insert into public.payout_splits(order_id, recipient_type, recipient_profile_id, amount, currency)
    values (v_order.id, 'creator_royalty', v_artwork.creator_id, v_royalty_amt, v_listing.sale_currency);
  end if;

  if v_charity_amt > 0 then
    insert into public.payout_splits(
      order_id, recipient_type, recipient_profile_id, recipient_wallet_address, amount, currency
    ) values (
      v_order.id, 'charity',
      v_listing.charity_target_id, v_listing.charity_wallet_address,
      v_charity_amt, v_listing.sale_currency
    );
  end if;

  insert into public.payout_splits(order_id, recipient_type, recipient_profile_id, amount, currency)
  values (v_order.id, 'seller', v_listing.seller_id, v_seller_take, v_listing.sale_currency);

  -- move ownership (ERC-721 semantics)
  -- decrement seller (delete if goes to 0)
  update public.ownerships
    set quantity = greatest(quantity - p_quantity, 0), updated_at = now()
    where artwork_id = v_listing.artwork_id and owner_id = v_listing.seller_id;

  delete from public.ownerships
    where artwork_id = v_listing.artwork_id and owner_id = v_listing.seller_id and quantity = 0;

  -- increment/insert buyer
  insert into public.ownerships(artwork_id, owner_id, quantity)
  values (v_listing.artwork_id, v_buyer_id, p_quantity)
  on conflict (artwork_id, owner_id)
  do update set quantity = public.ownerships.quantity + excluded.quantity,
               updated_at = now();

  -- end listing
  update public.listings
  set status = 'ended', updated_at = now()
  where id = v_listing.id;

  -- provenance
  insert into public.provenance_events(
    artwork_id, from_owner_id, to_owner_id, event_type,
    quantity, amount, currency, source
  )
  values (
    v_listing.artwork_id, v_listing.seller_id, v_buyer_id, 'sale',
    p_quantity, v_total, v_listing.sale_currency, 'system'
  );

  return v_order;
end;
$$;

-- RLS helper: allow selecting orders if you're buyer or seller
drop policy if exists orders_select_involved on public.orders;
create policy orders_select_involved
on public.orders
for select
to authenticated
using (buyer_id = auth.uid() or seller_id = auth.uid());
