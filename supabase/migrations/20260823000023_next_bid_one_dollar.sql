-- Migration: next-bid = current maximum + $1 (UI redesign business rule)
--
-- Business rule change for the console bidding UX:
--   The next required bid is now ALWAYS the current maximum reservation + $1.00
--   (100 cents), replacing the previous per-category `increment` floor:
--     - category selected : its own maximum + $1 ; $1 when it has no bids/reservations
--     - no selection      : the GLOBAL maximum across all categories + $1 ; $1 when the
--                           database has no bids at all
--   (`categories.increment` remains stored/displayed but no longer participates in the
--   pricing floor.)
--
-- Why a migration: create_pending_bid is the SINGLE authoritative writer of payment
-- amounts (row-locked recompute inside the critical section). Implementing max+$1 only
-- in application code would let the RPC reject valid $1-increment bids whenever a
-- configured increment exceeds $1 - so the floor itself must move here.
--
-- Safety invariants preserved verbatim from migrations 20260823000007/00008:
--   - SELECT ... FOR UPDATE on the category row serializes same-category bids
--   - pending-aware greatest(paid_max, pending_max) prevents concurrent double-reserve
--     (a pending reservation is treated exactly like a paid maximum when computing the
--     next floor, so simultaneous checkouts can never both pass validation)
--   - UNIQUE(stripe_session_id) duplicate arbitration and bid_error protocol unchanged
--   - SECURITY DEFINER + pinned search_path + service_role-only EXECUTE
--
-- Signature is UNCHANGED (5 parameters): CREATE OR REPLACE semantics, with defensive
-- privilege re-assertion.

drop function if exists public.create_pending_bid(uuid, integer, text, text, text);

create or replace function public.create_pending_bid(
  p_category_id uuid,
  p_amount integer,
  p_bidder_email text,
  p_bidder_name text,
  p_stripe_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step constant integer := 100; -- $1.00 step over the current maximum reservation
  v_first_bid constant integer := 100; -- $1.00 first bid when no reservations exist
  v_paid_max integer;
  v_pending_max integer;
  v_minimum integer;
  v_bid public.bids%rowtype;
begin
  -- Narrow critical section: lock only this category's row (active rows only).
  perform 1
    from public.categories c
   where c.id = p_category_id
     and c.is_active = true
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'bid_error:category_not_found';
  end if;

  -- Authoritative floor, computed inside the lock.
  select max(b.amount) into v_paid_max
    from public.bids b
   where b.category_id = p_category_id
     and b.status = 'paid';

  select max(b.amount) into v_pending_max
    from public.bids b
   where b.category_id = p_category_id
     and b.status = 'pending';

  if v_paid_max is null and v_pending_max is null then
    v_minimum := v_first_bid;
  else
    v_minimum := greatest(coalesce(v_paid_max, 0), coalesce(v_pending_max, 0)) + v_step;
  end if;

  if p_amount is null or p_amount < v_minimum then
    raise exception using errcode = 'P0001',
      message = 'bid_error:amount_below_minimum:' || v_minimum::text;
  end if;

  begin
    insert into public.bids (category_id, amount, bidder_email, bidder_name, status, stripe_session_id)
    values (p_category_id, p_amount, p_bidder_email, p_bidder_name, 'pending', p_stripe_session_id)
    returning * into v_bid;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'bid_error:duplicate_transaction';
  end;

  return to_jsonb(v_bid);
end;
$$;

-- Function remains callable ONLY through the server-side service role.
revoke execute on function public.create_pending_bid(uuid, integer, text, text, text) from public;
revoke execute on function public.create_pending_bid(uuid, integer, text, text, text) from anon;
revoke execute on function public.create_pending_bid(uuid, integer, text, text, text) from authenticated;
grant execute on function public.create_pending_bid(uuid, integer, text, text, text) to service_role;
