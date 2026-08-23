-- Migration: create categories table
-- Task 2.1 — Categories schema + migration
-- Matches PROJECT_PLAN.md exactly

-- Ensure pgcrypto for gen_random_uuid() (present by default on Supabase, safe to ensure)
create extension if not exists "pgcrypto";

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  starting_bid integer not null default 100,
  increment integer not null default 100,
  image_url text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
