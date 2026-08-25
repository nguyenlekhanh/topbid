-- Migration: enable RLS on processed_webhook_events (Task 9.7 - RLS review)
--
-- Defect found during Task 9.7 RLS review:
--   processed_webhook_events was created WITHOUT enabling Row Level Security.
--   In Supabase, tables in the public schema without RLS are accessible through
--   PostgREST by any principal that has table grants (anon/authenticated get ALL
--   by default). An attacker with only the anon key could enumerate webhook event
--   IDs and types via PostgREST table access.
--
-- Fix:
--   Enable RLS with ZERO policies. No anon/authenticated principal can read or
--   write; service-role bypasses RLS as designed (the only legitimate accessor,
--   inside SECURITY DEFINER functions and server-side webhook processing).
--
-- Impact on application behavior: NONE. The table is accessed exclusively through
--   SECURITY DEFINER functions running as service_role (which bypasses RLS), and
--   no application query reads from it directly.

alter table public.processed_webhook_events enable row level security;
