-- Migration: convert_pending_bid_to_paid RPC (webhook-driven confirmation)
-- Task 4.8 — Convert pending bid to paid
--
-- Preconditions (enforced here, never trusted from callers):
--   The webhook endpoint has already verified signature (4.6) and authoritative payment
--   status via Stripe's API (4.7); this function performs the state transition itself.
--
-- Fields changed on success:
--   status                  'pending' -> 'paid'
--   paid_at                 now()
--   stripe_payment_intent_id from the retrieved Checkout Session (nullable passthrough)
--   stripe_session_id       completed only when still NULL (Task 4.2 crash window);
--                           an existing DIFFERENT value rejects the conversion
--
-- is_highest is deliberately NOT set here: PROJECT_PLAN.md assigns it no role in this
-- task, and every ranking query derives order dynamically from amount/status.
--
-- Outcomes returned as text:
--   'converted'        state transition applied
--   'already_paid'     same bid already paid with the SAME session id - retry/replay of
--                      an applied confirmation; treated as success (natural idempotency
--                      keyed on bid+session identity, distinct from Task 4.9's event-id
--                      ledger)
--   'bid_not_found'    reference points at no row
--   'invalid_state'    row exists but is neither pending nor paid-with-same-session
--                      (failed/refunded anomalies)
--   'session_mismatch' pending row already linked to a DIFFERENT session id
--
-- Concurrency:
--   SELECT ... FOR UPDATE locks the single bid row; concurrent webhooks serialize there
--   and re-read committed state, so double conversion is impossible. Category-row locks
--   from Task 3.6 are untouched (different table), preserving creation-path guarantees.
--
-- Security:
--   SECURITY DEFINER with pinned search_path (RLS bypassed like Tasks 3.6/3.7/4.2);
--   EXECUTE revoked from public/anon/authenticated, granted ONLY to service_role.

create or replace function public.convert_pending_bid_to_paid(
  p_bid_id uuid,
  p_stripe_session_id text,
  p_stripe_payment_intent_id text
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
  if p_stripe_session_id is null or p_stripe_session_id = '' then
    raise exception using errcode = 'P0001', message = 'bid_error:invalid_stripe_session';
  end if;

  select b.status, b.stripe_session_id
    into v_status, v_session_id
    from public.bids b
   where b.id = p_bid_id
   for update;

  if not found then
    return 'bid_not_found';
  end if;

  if v_session_id is not null and v_session_id <> p_stripe_session_id then
    return 'session_mismatch';
  end if;

  if v_status = 'paid' then
    -- Same-session replay of an already-applied confirmation.
    return 'already_paid';
  end if;

  if v_status <> 'pending' then
    return 'invalid_state';
  end if;

  update public.bids
     set status = 'paid',
         paid_at = now(),
         stripe_payment_intent_id = p_stripe_payment_intent_id,
         stripe_session_id = coalesce(v_session_id, p_stripe_session_id)
   where id = p_bid_id;

  return 'converted';
end;
$$;

-- Function is callable ONLY through the server-side service role.
revoke execute on function public.convert_pending_bid_to_paid(uuid, text, text) from public;
revoke execute on function public.convert_pending_bid_to_paid(uuid, text, text) from anon;
revoke execute on function public.convert_pending_bid_to_paid(uuid, text, text) from authenticated;
grant execute on function public.convert_pending_bid_to_paid(uuid, text, text) to service_role;
