-- Migration: enable RLS and configure public read policies
-- Task 2.5 — RLS / security policies
-- Matches PROJECT_PLAN.md security model exactly

-- Enable Row Level Security on MVP tables
alter table public.categories enable row level security;
alter table public.bids enable row level security;

-- Categories: public can SELECT only active categories
-- Covers anon role (unauthenticated browser) via PUBLIC; no auth required for MVP
-- No public INSERT/UPDATE/DELETE policies -> those actions are denied for anon/authenticated
create policy categories_public_select_active
  on public.categories
  for select
  using (is_active = true);

-- Bids: public can SELECT only paid bids (leaderboard)
-- Covers anon role; pending/failed/refunded are not readable publicly
-- No public INSERT/UPDATE/DELETE policies -> writes denied for anon/authenticated
create policy bids_public_select_paid
  on public.bids
  for select
  using (status = 'paid');

-- Note: service_role bypasses RLS by design (Supabase), so server-side writes continue without a public write policy.
-- No service_role policies created intentionally; no WITH CHECK (true) write policies created.
