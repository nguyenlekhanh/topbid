-- Migration: banned_emails table (Task 8.7 - Fraud/banned email management)
--
-- Purpose:
--   First-party blocklist of fraudulent/banned email addresses. An entry prevents the
--   address from creating new bids (enforced inside createPendingBid, the single
--   choke point every bid/checkout flows through) and from receiving outbid
--   notifications.
--
-- Identity/canonicalization:
--   email_canonical = lower(trimmed(raw email)). Bids store bidder_email as entered
--   (trimmed), so enforcement compares candidates case-insensitively against this
--   canonical form. UNIQUE(email_canonical) makes duplicate bans deterministic
--   no-ops (ON CONFLICT DO NOTHING).
--
-- Separation of concerns:
--   This is FRAUD state managed by administrators. It is distinct from
--   notification_unsubscribes (recipient consent, Task 6.6) - neither substitutes
--   for the other, and both are enforced independently.
--
-- Privacy/access model:
--   Only the canonical address is stored (no IPs, names, device data). RLS enabled
--   with ZERO policies - anon/authenticated can neither read nor write; all access
--   happens server-side through the service role behind the Task 8.1 admin gate.

create table public.banned_emails (
  id bigint generated always as identity primary key,
  email_canonical text not null unique,
  created_at timestamptz not null default now()
);

alter table public.banned_emails enable row level security;

-- Intentionally NO policies created: the blocklist is server-side/admin-only state.
