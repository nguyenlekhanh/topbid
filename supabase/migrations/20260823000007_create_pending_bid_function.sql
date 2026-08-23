-- Migration: create_pending_bid RPC function (concurrency-safe reservation)
-- Task 3.6 — Handle concurrent bids (DB locking)
--
-- Why a database function:
--   supabase-js cannot open transactions or take row locks; every .from() call is an
--   independent PostgREST request, so calculate-minimum + insert cannot be made atomic
--   from application code. The whole critical section therefore lives here.
--
-- Locking strategy (narrowest correct approach):
--   SELECT ... FOR UPDATE on the single categories row for the target category.
--   - Same-category transactions serialize on that one row lock.
--   - Different categories lock different rows and proceed concurrently.
--   - Lock is held only for this transaction and released on commit/rollback.
--   No advisory locks, no isolation-level changes, no schema changes.
--
-- Reservation correctness:
--   The authoritative floor is computed INSIDE the lock and accounts for existing
--   pending reservations as well as paid bids. Otherwise a transaction unblocked after
--   another commits a PENDING bid (not yet visible as paid) would recompute the same
--   minimum and both would reserve the same amount slot based on stale state.
--     - no paid and no pending bids  -> minimum = categories.starting_bid
--     - otherwise                    -> minimum = greatest(paid_max, pending_max) + increment
--
-- Security:
--   SECURITY DEFINER with a pinned search_path; RLS is bypassed by the definer context,
--   so the function itself re-checks is_active and recomputes the minimum authoritatively.
--   Postgres grants EXECUTE to PUBLIC by default: it is revoked from public, anon and
--   authenticated and granted ONLY to service_role, matching the server-side-only write
--   model (public clients never receive the service-role key).
--
-- Error protocol for callers (mapped in src/lib/bids.ts):
--   raise 'bid_error:category_not_found'
--   raise 'bid_error:amount_below_minimum:<minimum>'

create or replace function public.create_pending_bid(
  p_category_id uuid,
  p_amount integer,
  p_bidder_email text,
  p_bidder_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_starting_bid integer;
  v_increment integer;
  v_paid_max integer;
  v_pending_max integer;
  v_minimum integer;
  v_bid public.bids%rowtype;
begin
  -- Narrow critical section: lock only this category's row (active rows only).
  select c.starting_bid, c.increment
    into v_starting_bid, v_increment
    from public.categories c
   where c.id = p_category_id
     and c.is_active = true
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'bid_error:category_not_found';
  end if;

  -- Authoritative minimum, computed inside the lock (paid + pending reservations).
  select max(b.amount) into v_paid_max
    from public.bids b
   where b.category_id = p_category_id
     and b.status = 'paid';

  select max(b.amount) into v_pending_max
    from public.bids b
   where b.category_id = p_category_id
     and b.status = 'pending';

  if v_paid_max is null and v_pending_max is null then
    v_minimum := v_starting_bid;
  else
    v_minimum := greatest(coalesce(v_paid_max, 0), coalesce(v_pending_max, 0)) + v_increment;
  end if;

  if p_amount is null or p_amount < v_minimum then
    raise exception using errcode = 'P0001',
      message = 'bid_error:amount_below_minimum:' || v_minimum::text;
  end if;

  insert into public.bids (category_id, amount, bidder_email, bidder_name, status)
  values (p_category_id, p_amount, p_bidder_email, p_bidder_name, 'pending')
  returning * into v_bid;

  return to_jsonb(v_bid);
end;
$$;

-- Function is callable ONLY through the server-side service role.
revoke execute on function public.create_pending_bid(uuid, integer, text, text) from public;
revoke execute on function public.create_pending_bid(uuid, integer, text, text) from anon;
revoke execute on function public.create_pending_bid(uuid, integer, text, text) from authenticated;
grant execute on function public.create_pending_bid(uuid, integer, text, text) to service_role;
