-- Migration: refund_paid_bid RPC (refund handling)
-- Task 4.11 — Refund handling
--
-- Purpose:
--   When Stripe reports a refund (charge.refunded) for the payment behind a bid, the
--   PAID bid transitions to the schema-defined 'refunded' status (migration 2.2,
--   CHECK-constrained in 2.4). The authoritative linkage is stripe_payment_intent_id,
--   persisted by Task 4.8 during conversion.
--
-- Authoritative verification (application side, Task 4.7 discipline):
--   The endpoint retrieves the charge from Stripe's API and requires refunded = true
--   before invoking this function - the event body is never trusted alone.
--
-- State machine:
--   paid    -> refunded (this function)
--   pending / failed / refunded -> not refundable ('bid_not_found' / 'invalid_state')
--
-- Idempotency (Task 4.9 pattern):
--   Ledger claim + state transition share one transaction. unique_violation on the
--   claim -> 'duplicate'; 'already_refunded' -> repeat of an applied refund (no-op);
--   anomalies raise -> claim and effect roll back -> event retryable.
--
-- Security: SECURITY DEFINER + pinned search_path (consistent with Tasks 3.6-4.10);
-- EXECUTE revoked from public/anon/authenticated, granted ONLY to service_role.

create or replace function public.refund_paid_bid(
  p_event_id text,
  p_event_type text,
  p_stripe_payment_intent_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bid public.bids%rowtype;
begin
  begin
    insert into public.processed_webhook_events (event_id, type)
    values (p_event_id, p_event_type);
  exception
    when unique_violation then
      return 'duplicate';
  end;

  select b.*
    into v_bid
    from public.bids b
   where b.stripe_payment_intent_id = p_payment_intent_id
   for update;

  if not found then
    return 'bid_not_found';
  end if;

  if v_bid.status = 'refunded' then
    return 'already_refunded';
  end if;

  if v_bid.status <> 'paid' then
    return 'invalid_state';
  end if;

  update public.bids
     set status = 'refunded'
   where id = v_bid.id;

  return 'refunded';
end;
$$;

-- Function is callable ONLY through the server-side service role.
revoke execute on function public.refund_paid_bid(text, text, text) from public;
revoke execute on function public.refund_paid_bid(text, text, text) from anon;
revoke execute on function public.refund_paid_bid(text, text, text) from authenticated;
grant execute on function public.refund_paid_bid(text, text, text) to service_role;
