-- Migration: admin_users table (Task 8.1 - Admin authentication)
--
-- Purpose:
--   Authoritative, database-backed representation of administrator identity for
--   Phase 8 admin functionality. An admin is a Supabase Auth user (auth.users row)
--   whose id appears here; possession of a valid session alone never grants access.
--
-- Identity model:
--   id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE - one row per
--   admin, keyed by the Supabase Auth user id. Provisioning happens out of band
--   (create the auth user in the Supabase dashboard, then insert the id here via
--   SQL as service role/dashboards allow); no self-service signup path exists.
--
-- Access model (least privilege):
--   RLS enabled with exactly ONE policy: an authenticated user may read their OWN
--   row (id = auth.uid()). This lets the server-side authorization guard verify
--   membership under the caller's own JWT without touching the service role.
--   Inserts/updates/deletes remain service-role/dashboard operations only.
--   Anonymous visitors can read nothing.

create table public.admin_users (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create policy admin_users_select_own
  on public.admin_users
  for select
  using (id = auth.uid());
