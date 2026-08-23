-- Migration: duplicate-transaction prevention in create_pending_bid
-- Task 3.7 — Prevent duplicate transactions
--
-- Definition of "duplicate transaction" (from existing schema/plan, nothing invented):
--   public.bids.stripe_session_id is declared UNIQUE (Task 2.2), indexed by
--   idx_bids_stripe_session (Task 2.3), and PROJECT_PLAN.md Phase 4.9 builds idempotent
--   webhook handling on that same identity. A duplicate transaction is therefore a second
--   bids row carrying an already-used stripe_session_id.
--
-- Integration approach:
--   Reuse the EXISTING single-column UNIQUE(stripe_session_id) constraint as the race-safe
--   arbiter - PostgreSQL enforces it atomically at commit time even for simultaneous
--   inserts, so two attempts with the same identifier can never both succeed. No new
--   constraints or indexes are added. UNIQUE(category_id, stripe_session_id) remains
--   unchanged; it is subsumed by the stricter single-column constraint for non-null ids
--   and kept for plan fidelity. NULLs stay distinct, so bids created without a session id
--   (the current Task 3.5 behavior) are unaffected.
--
-- Concurrency (Task 3.6) preserved:
--   The category-row FOR UPDATE lock and pending-aware minimum recheck are unchanged; the
--   insert still happens inside the locked critical section. The unique violation is now
--   caught and translated into the stable bid_error protocol.
--
-- Migration mechanics note:
--   CREATE OR REPLACE cannot change a function's parameter list in place - it would create
--   an overload while the old 4-parameter signature lingers. The old signature is dropped
--   explicitly first; privileges are per-signature, so revokes/grants are re-applied.
--
-- Error protocol addition (mapped in src/lib/bids.ts):
--   'bid_error:duplicate_transaction' when the session identifier is already used.

drop function if exists public.create_pending_bid(uuid, integer, text, text);

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

  begin
    insert into public.bids (category_id, amount, bidder_email, bidder_name, status, stripe_session_id)
    values (p_category_id, p_amount, p_bidder_email, p_bidder_name, 'pending', p_stripe_session_id)
    returning * into v_bid;
  exception
    -- Race-safe arbitration: UNIQUE(stripe_session_id) guarantees exactly one winner even
    -- for simultaneous inserts with the same identifier; the loser lands here.
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'bid_error:duplicate_transaction';
  end;

  return to_jsonb(v_bid);
end;
$$;

-- Function is callable ONLY through the server-side service role.
revoke execute on function public.create_pending_bid(uuid, integer, text, text, text) from public;
revoke execute on function public.create_pending_bid(uuid, integer, text, text, text) from anon;
revoke execute on function public.create_pending_bid(uuid, integer, text, text, text) from authenticated;
grant execute on function public.create_pending_bid(uuid, integer, text, text, text) to service_role;
