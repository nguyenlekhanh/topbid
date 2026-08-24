-- Migration: notification_unsubscribes table (Task 6.6 — Unsubscribe handling)
--
-- Purpose:
--   Application-managed outbid-notification opt-out state. Recipients have no accounts
--   (MVP constraint), so a recipient-specific capability token identifies them securely:
--   recipient_hash = HEX(HMAC-SHA256(UNSUBSCRIBE_SECRET, lowercased_email)).
--
-- Privacy / security properties:
--   - Raw email addresses are NEVER stored here - only the keyed hash, which cannot be
--     reversed without the server-only UNSUBSCRIBE_SECRET
--   - The hash IS the unsubscribe token carried in URLs: possessing it proves the link
--     was issued to that recipient; it cannot be computed or guessed for another address
--   - Deterministic per recipient, so suppression lookups and URL tokens agree exactly
--
-- Idempotency:
--   PRIMARY KEY on recipient_hash makes repeated unsubscribes no-ops via
--   ON CONFLICT DO NOTHING at the write site.
--
-- Access model:
--   RLS enabled with ZERO policies - anon/authenticated can neither read nor write;
--   only the server-side service role (which bypasses RLS by design) touches this
--   table, matching the project's "service role for writes" rule.

create table public.notification_unsubscribes (
  recipient_hash text primary key,
  unsubscribed_at timestamptz not null default now()
);

alter table public.notification_unsubscribes enable row level security;

-- Intentionally NO policies created: the table exists purely for server-side
-- suppression checks and unsubscribe writes performed with the service role.
