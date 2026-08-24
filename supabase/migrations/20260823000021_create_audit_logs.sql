-- Migration: audit_logs table (Task 8.8 - Audit logs)
--
-- Purpose:
--   Immutable trail of administrative MUTATIONS performed through Phase 8 surfaces:
--   category create/update/activate/deactivate, the refund action, and
--   banned-email ban/unban. Read-only views (dashboard/bids/payments lists) are not
--   mutations and are not audited.
--
-- Record anatomy (who / what / on what / when / context):
--   actor_user_id  Supabase Auth user id from getAdminContext - the verified actor,
--                  never a client-supplied claim
--   actor_email    snapshot of the admin's email at action time so the trail stays
--                  self-describing even if the auth user is later deleted
--   action         allow-listed name (category.* | payment.refund | banned_email.*)
--   target_type/id resource identifier from the SERVER-SIDE mutation result
--   detail         small structured context (no secrets/tokens/full payloads)
--
-- Immutability:
--   RLS enabled with ZERO policies: anon/authenticated can neither read nor write.
--   Only server-side service-role inserts exist; no update/delete code paths exist.

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null,
  actor_email text not null,
  action text not null check (
    action in (
      'category.create',
      'category.update',
      'category.activate',
      'category.deactivate',
      'payment.refund',
      'banned_email.ban',
      'banned_email.unban'
    )
  ),
  target_type text,
  target_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_created_at on public.audit_logs (created_at desc);

alter table public.audit_logs enable row level security;

-- Intentionally NO policies created: audit data is server/admin-only state.
