-- Migration: fail_pending_bid RPC (payment failure handling)
-- Task 4.10 — Payment failure handling
--
-- Purpose:
--   When Stripe reports a Checkout payment attempt failed
--   (checkout.session.async_payment_failed), the linked PENDING bid transitions to the
--   schema-defined 'failed' status (migration 2.2, CHECK-constrained in 2.4) instead of
--   holding its reservation slot forever.
--
-- Safety properties:
--   - Claim + effect atomicity identical to Task 4.9: the processed_webhook_events claim
--     INSERT and the state transition share one transaction; unique_violation on the
--     claim returns 'duplicate'; conversion anomalies raise and roll back BOTH, keeping
--     the event retryable.
--   - A bid that is already 'paid' is NEVER downgraded: an async-failure notice for an
--     already-paid session is contradictory and is answered 'already_paid' (no-op).
--   - Repeated failures of the same session return 'already_failed' (success/no-op).
--   - Session linkage follows Task 4.8 rules: NULL completes the Task 4.2 crash window;
--     a different existing value rejects ('session_mismatch').
--   - 'refunded' or unknown statuses raise 'bid_error:invalid_state'.
--
-- Outcomes returned as text:
--   'failed', 'already_failed', 'already_paid', 'duplicate'
--   (anomalies raise; endpoint answers 500 so Stripe retries)
--
-- Security: SECURITY DEFINER + pinned search_path (consistent with Tasks 3.6-4.9);
-- EXECUTE revoked from public/anon/authenticated, granted ONLY to service_role.

create or replace function public.fail_pending_bid(
  p_event_id text,
  p_event_type text,
  p_bid_id uuid,
  p_stripe_session_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_session_id text;
begin
  begin
    insert into public.processed_webhook_events (event_id, type)
    values (p_event_id, p_event_type);
  exception
    when unique_violation then
      return 'duplicate';
  end;

  select b.status, b.stripe_session_id
    into v_status, v_session_id
    from public.bids b
   where b.id = p_bid_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'bid_error:bid_not_found';
  end if;

  if v_status = 'paid' then
    -- Contradictory notice: authoritative confirmation already applied. Never downgrade.
    return 'already_paid';
  end if;

  if v_status = 'failed' then
    return 'already_failed';
  end if;

  if v_status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'bid_error:invalid_state';
  end if;

  if v_session_id is not null and v_session_id <> p_stripe_session_id then
    raise exception using errcode = 'P0001', message = 'bid_error:session_mismatch';
  end if;

  update public.bids
     set status = 'failed',
         stripe_session_id = coalesce(v_session_id, p_stripe_session_id)
   where id = p_bid_id;

  return 'failed';
end;
$$;

-- Function is callable ONLY through the server-side service role.
revoke execute on function public.fail_pending_bid(text, text, uuid, text) from public;
revoke execute on function public.fail_pending_bid(text, text, uuid, text) from anon;
revoke execute on function public.fail_pending_bid(text, text, uuid, text) from authenticated;
grant execute on function public.fail_pending_bid(text, text, uuid, text) to service_role;
