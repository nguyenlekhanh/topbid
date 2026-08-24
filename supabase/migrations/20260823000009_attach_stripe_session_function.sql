-- Migration: attach_stripe_session RPC (link Checkout Session to its pending bid)
-- Task 4.2 — Attach category/bid metadata
--
-- Purpose:
--   After the Checkout Session is created, its identifier is persisted onto the
--   authoritative bid record so webhook handling (Tasks 4.5+) can resolve the bid by
--   session (idx_bids_stripe_session exists for this since Task 2.3). The application
--   simultaneously sets client_reference_id = bid id and metadata {bid_id, category_id}
--   on the session itself.
--
-- Attach-once guarantee (preserves Task 3.7 duplicate semantics):
--   The UPDATE only matches bids that are still 'pending' AND have no stripe_session_id
--   yet. Once attached, the row never matches again - the same session can never be
--   re-attached or moved to another bid. UNIQUE(stripe_session_id) additionally makes
--   concurrent attaches of one identifier across different bids impossible (race-safe);
--   a violation is surfaced as the established bid_error protocol message.
--
-- Security:
--   SECURITY DEFINER with pinned search_path (definer context bypasses RLS like Tasks
--   3.6/3.7 functions); EXECUTE revoked from public/anon/authenticated and granted ONLY
--   to service_role - public clients keep read-only access under RLS and never see
--   service credentials.

create or replace function public.attach_stripe_session(
  p_bid_id uuid,
  p_stripe_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_stripe_session_id is null or p_stripe_session_id = '' then
    raise exception using errcode = 'P0001', message = 'bid_error:invalid_stripe_session';
  end if;

  begin
    update public.bids
       set stripe_session_id = p_stripe_session_id
     where id = p_bid_id
       and status = 'pending'
       and stripe_session_id is null;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'bid_error:duplicate_transaction';
  end;

  get diagnostics v_updated = row_count;

  return v_updated > 0;
end;
$$;

-- Function is callable ONLY through the server-side service role.
revoke execute on function public.attach_stripe_session(uuid, text) from public;
revoke execute on function public.attach_stripe_session(uuid, text) from anon;
revoke execute on function public.attach_stripe_session(uuid, text) from authenticated;
grant execute on function public.attach_stripe_session(uuid, text) to service_role;
