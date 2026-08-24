-- Migration: fix refund_paid_bid parameter reference (Task 8.6 - Refund action)
--
-- Defect corrected (uncovered by the Task 8.6 audit):
--   Migration 20260823000013 declared the parameter p_stripe_payment_intent_id but
--   the membership SELECT referenced p_payment_intent_id - an undeclared identifier.
--   PL/pgSQL defers identifier resolution to execution time, so every invocation
--   raised 'column "p_payment_intent_id" does not exist' instead of performing the
--   refund transition. Unit tests did not catch this because Supabase calls were
--   mocked; the integration suite skips without credentials.
--
-- Change: reference the declared parameter. Signature, locking, state machine,
--   idempotency (ledger claim -> duplicate / already_refunded no-ops), and grants are
--   unchanged. CREATE OR REPLACE keeps the same signature (no re-grant churn needed,
--   but privileges are re-asserted defensively below).
--
-- Consumers: charge.refunded webhook handler (Task 4.11) and, from Task 8.6 onward,
--   the admin-initiated refund flow (event_id = Stripe refund id, event_type =
--   'admin.refund'); both preserve processed_webhook_events idempotency semantics.

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
   where b.stripe_payment_intent_id = p_stripe_payment_intent_id
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

-- Function remains callable ONLY through the server-side service role.
revoke execute on function public.refund_paid_bid(text, text, text) from public;
revoke execute on function public.refund_paid_bid(text, text, text) from anon;
revoke execute on function public.refund_paid_bid(text, text, text) from authenticated;
grant execute on function public.refund_paid_bid(text, text, text) to service_role;
