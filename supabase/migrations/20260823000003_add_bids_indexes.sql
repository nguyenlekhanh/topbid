-- Migration: add indexes for bids table
-- Task 2.3 — Database indexes
-- Matches PROJECT_PLAN.md exactly

-- Index for filtering by category and status (e.g., pending/paid lookups)
create index idx_bids_category_status on public.bids (category_id, status);

-- Partial index for leaderboard/paid amount queries: only paid bids ordered by amount desc
create index idx_bids_category_paid_amount on public.bids (category_id, amount desc) where status = 'paid';

-- Index for Stripe session lookups (note: unique constraint on stripe_session_id already creates a btree index internally as bids_stripe_session_id_key; this explicit index is retained as planned and documented as potentially redundant)
create index idx_bids_stripe_session on public.bids (stripe_session_id);

-- Index for Stripe payment intent lookups
create index idx_bids_payment_intent on public.bids (stripe_payment_intent_id);
