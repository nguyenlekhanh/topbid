-- Migration: share_events table (Task 7.7 — Share tracking)
--
-- Purpose:
--   First-party counting of explicit user share actions from the bid success page
--   (Task 7.2 Share on X clicks and Task 7.3 Copy link successes). This is the only
--   analytics surface in the project - no third-party provider exists or is used.
--
-- Data minimization:
--   Rows record WHICH kind of share action happened and WHEN - nothing else. No URLs,
--   no category/category-slug attribution, no session/payment/bid identifiers, no
--   bidder email, no IP addresses, no user-agent strings, no cookies or fingerprints.
--
-- Duplicate semantics (intentional):
--   Every explicit user action inserts one row. Repeated shares/copies are separate
--   events by design; no deduplication rule is invented because the plan specifies none.
--
-- Non-authoritative:
--   Pure observability. Nothing in the bidding/payment/notification flow reads this
--   table, and write failures can never affect share/copy behavior.
--
-- Access model:
--   RLS enabled with ZERO policies - anon/authenticated cannot read or write;
--   inserts happen server-side through the /api/share-events route using the
--   service role (which bypasses RLS by design).

create table public.share_events (
  id bigint generated always as identity primary key,
  event text not null check (event in ('x_share', 'copy_link')),
  created_at timestamptz not null default now()
);

alter table public.share_events enable row level security;

-- Intentionally NO policies created: aggregate counts are read server-side/admin-only
-- (Phase 8+ dashboards are out of scope for Task 7.7).
