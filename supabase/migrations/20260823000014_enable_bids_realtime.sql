-- Migration: enable Supabase Realtime for the bids table
-- Task 5.1 — Supabase realtime subscription
--
-- Why: client-side postgres_changes subscriptions only receive events for tables added
-- to the supabase_realtime publication. Without this, no realtime events are delivered.
--
-- RLS preserved: browsers subscribe with the anon key, so postgres_changes deliveries
-- are filtered by the existing bids_public_select_paid policy - clients only ever see
-- PAID bids, which is exactly the leaderboard/recent-bids state (Tasks 5.2-5.4).
-- No service credentials are involved in realtime delivery.
--
-- Idempotent: guarded so re-running never duplicates the publication membership.

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'bids'
  ) then
    alter publication supabase_realtime add table public.bids;
  end if;
end
$$;
