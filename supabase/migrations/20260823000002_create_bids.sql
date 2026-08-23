-- Migration: create bids table
-- Task 2.2 — Bids schema + migration
-- Matches PROJECT_PLAN.md exactly (additive after categories)

create table public.bids (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete cascade,
  amount integer not null,
  bidder_email text not null,
  bidder_name text,
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  status text not null default 'pending',
  is_highest boolean default false,
  created_at timestamptz default now(),
  paid_at timestamptz,
  unique (category_id, stripe_session_id)
);
