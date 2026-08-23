-- Migration: add CHECK constraints
-- Task 2.4 — Constraints
-- Justified by PROJECT_PLAN.md invariants, additive, no RLS/seed

-- Categories: starting_bid is INTEGER cents, must not be negative (plan: DEFAULT 100)
-- Allows 0 per plan (not requiring >0)
alter table public.categories
  add constraint categories_starting_bid_non_negative
  check (starting_bid >= 0);

-- Categories: increment is INTEGER cents, must not be negative (plan: DEFAULT 100)
-- Allows 0 per task instructions (not requiring >0)
alter table public.categories
  add constraint categories_increment_non_negative
  check (increment >= 0);

-- Bids: amount is INTEGER cents, must not be negative
alter table public.bids
  add constraint bids_amount_non_negative
  check (amount >= 0);

-- Bids: status must be one of planned values: pending, paid, failed, refunded
-- Matches plan comment: 'pending', 'paid', 'failed', 'refunded'
alter table public.bids
  add constraint bids_status_check
  check (status in ('pending', 'paid', 'failed', 'refunded'));
