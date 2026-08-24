-- Migration: idempotent webhook event processing (event-id ledger)
-- Task 4.9 — Idempotent webhook handling
--
-- Mechanism (per AGENTS.md: "Use event IDs to prevent duplicate processing"):
--   processed_webhook_events is keyed by Stripe's authoritative event.id (PRIMARY KEY).
--   The uniqueness constraint - not application check-then-insert - is the final arbiter:
--   two concurrent deliveries of one event serialize on the PK and exactly one claim wins.
--
-- Claim + effect atomicity:
--   process_checkout_completed_event claims the event (INSERT) and applies the business
--   effect (Task 4.8 conversion) in the SAME transaction. If the conversion reports an
--   anomaly it raises, rolling back BOTH the effect and the claim - so failed processing
--   leaves the event retryable instead of permanently swallowed. Outcomes:
--     'converted'    first delivery; claim written, bid converted
--     'already_paid' bid was already paid with the same session (pre-ledger replay)
--     'duplicate'    this event.id was claimed before -> acknowledge, do nothing
--     raises         bid_not_found / invalid_state / session_mismatch (claim rolled back;
--                    endpoint answers 500 so Stripe retries)
--
-- Scope note: only checkout.session.completed passes through here because it is the only
-- plan-required type with business effects; unsupported events remain acknowledged
-- without ledger entries (Task 4.5 semantics unchanged).
--
-- Security: SECURITY DEFINER + pinned search_path (consistent with Tasks 3.6-4.2);
-- table has no public policies (RLS would deny anon reads even if enabled - it is simply
-- never accessed outside definer context); EXECUTE granted ONLY to service_role.

create table public.processed_webhook_events (
  event_id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

create or replace function public.process_checkout_completed_event(
  p_event_id text,
  p_event_type text,
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
  v_conversion_outcome text;
begin
  begin
    insert into public.processed_webhook_events (event_id, type)
    values (p_event_id, p_event_type);
  exception
    when unique_violation then
      return 'duplicate';
  end;

  v_conversion_outcome := public.convert_pending_bid_to_paid(
    p_bid_id,
    p_stripe_session_id,
    p_stripe_payment_intent_id
  );

  if v_conversion_outcome = 'bid_not_found' then
    raise exception using errcode = 'P0001', message = 'bid_error:bid_not_found';
  end if;

  if v_conversion_outcome = 'invalid_state' then
    raise exception using errcode = 'P0001', message = 'bid_error:invalid_state';
  end if;

  if v_conversion_outcome = 'session_mismatch' then
    raise exception using errcode = 'P0001', message = 'bid_error:session_mismatch';
  end if;

  return v_conversion_outcome;
end;
$$;

-- Function is callable ONLY through the server-side service role.
revoke execute on function public.process_checkout_completed_event(text, text, uuid, text, text) from public;
revoke execute on function public.process_checkout_completed_event(text, text, uuid, text, text) from anon;
revoke execute on function public.process_checkout_completed_event(text, text, uuid, text, text) from authenticated;
grant execute on function public.process_checkout_completed_event(text, text, uuid, text, text) to service_role;
