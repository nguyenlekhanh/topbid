-- Migration: outbid_notification_deliveries (Task 6.7 — Email failure handling)
--
-- Purpose:
--   Per-bid notification delivery state that decouples EMAIL retry from PAYMENT
--   idempotency. One logical outbid notification exists per newly paid bid; this row
--   tracks whether its email actually went out.
--
-- Notification-attempt idempotency:
--   PRIMARY KEY on bid_id guarantees at most one logical notification per bid - a
--   second row can never exist, so repeated webhook-driven attempts can never create
--   duplicate logical notifications.
--
-- Status model (drives retry decisions at the webhook boundary):
--   'pending'           send outcome unknown yet (e.g. process died mid-send)
--   'sent'              delivered; NEVER resent regardless of how many times the
--                       webhook event is redelivered
--   'failed_retryable'  transport-unconfirmed failure (timeout/network) - eligible for
--                       retry when Stripe redelivers the event
--   'failed_permanent'  provider rejected the request (invalid recipient/config);
--                       never retried
--
-- Relationship to payment idempotency (Tasks 4.8/4.9):
--   processed_webhook_events (event.id PK) keeps conversion exactly-once INDEPENDENTLY
--   of this table; redelivered events answer 'duplicate' before touching bids, while
--   this table alone decides whether the EMAIL may be attempted again.
--
-- Access model:
--   RLS enabled with ZERO policies - server-side service role only, matching
--   notification_unsubscribes (Task 6.6). FK cascade keeps rows lifecycle-tied to bids.

create table public.outbid_notification_deliveries (
  bid_id uuid primary key references public.bids (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed_retryable', 'failed_permanent')),
  attempts integer not null default 1 check (attempts >= 1),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.outbid_notification_deliveries enable row level security;

-- Intentionally NO policies created: delivery state is server-only infrastructure.
