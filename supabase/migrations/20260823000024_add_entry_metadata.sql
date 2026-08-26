-- Migration: add public-entry metadata columns and update create_pending_bid RPC
-- Task: Persist public-entry display metadata when a bid is created
--
-- 1. Add nullable metadata columns to bids table (backward compatible)
-- 2. Drop the 5-param create_pending_bid from migration 23
-- 3. Create new 11-param create_pending_bid with identical pricing/locking/validation logic
--    plus 6 metadata fields stored on INSERT

-- 1. Add nullable metadata columns
ALTER TABLE public.bids ADD COLUMN entry_title text;
ALTER TABLE public.bids ADD COLUMN entry_description text;
ALTER TABLE public.bids ADD COLUMN entry_canonical_url text;
ALTER TABLE public.bids ADD COLUMN entry_image_url text;
ALTER TABLE public.bids ADD COLUMN entry_favicon_url text;
ALTER TABLE public.bids ADD COLUMN entry_type text CHECK (entry_type IN ('url', 'handle', 'unknown'));

-- 2. Drop the 5-param function created by migration 23
DROP FUNCTION IF EXISTS public.create_pending_bid(uuid, integer, text, text, text);

-- 3. Create new 11-param function (first 5 identical, 6 new with defaults)
CREATE OR REPLACE FUNCTION public.create_pending_bid(
  p_category_id uuid,
  p_amount integer,
  p_bidder_email text,
  p_bidder_name text,
  p_stripe_session_id text,
  p_entry_title text DEFAULT NULL,
  p_entry_description text DEFAULT NULL,
  p_entry_canonical_url text DEFAULT NULL,
  p_entry_image_url text DEFAULT NULL,
  p_entry_favicon_url text DEFAULT NULL,
  p_entry_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step CONSTANT integer := 100; -- $1.00 step over the current maximum reservation
  v_first_bid CONSTANT integer := 100; -- $1.00 first bid when no reservations exist
  v_paid_max integer;
  v_pending_max integer;
  v_minimum integer;
  v_bid public.bids%rowtype;
BEGIN
  -- Narrow critical section: lock only this category's row (active rows only).
  PERFORM 1
    FROM public.categories c
   WHERE c.id = p_category_id
     AND c.is_active = true
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'bid_error:category_not_found';
  END IF;

  -- Authoritative floor, computed inside the lock.
  SELECT MAX(b.amount) INTO v_paid_max
    FROM public.bids b
   WHERE b.category_id = p_category_id
     AND b.status = 'paid';

  SELECT MAX(b.amount) INTO v_pending_max
    FROM public.bids b
   WHERE b.category_id = p_category_id
     AND b.status = 'pending';

  IF v_paid_max IS NULL AND v_pending_max IS NULL THEN
    v_minimum := v_first_bid;
  ELSE
    v_minimum := GREATEST(COALESCE(v_paid_max, 0), COALESCE(v_pending_max, 0)) + v_step;
  END IF;

  IF p_amount IS NULL OR p_amount < v_minimum THEN
    RAISE EXCEPTION USING errcode = 'P0001',
      MESSAGE = 'bid_error:amount_below_minimum:' || v_minimum::text;
  END IF;

  BEGIN
    INSERT INTO public.bids (
      category_id, amount, bidder_email, bidder_name, status, stripe_session_id,
      entry_title, entry_description, entry_canonical_url, entry_image_url, entry_favicon_url, entry_type
    ) VALUES (
      p_category_id, p_amount, p_bidder_email, p_bidder_name, 'pending', p_stripe_session_id,
      p_entry_title, p_entry_description, p_entry_canonical_url, p_entry_image_url, p_entry_favicon_url, p_entry_type
    ) RETURNING * INTO v_bid;
  EXCEPTION
    WHEN UNIQUE_VIOLATION THEN
      RAISE EXCEPTION USING errcode = 'P0001', message = 'bid_error:duplicate_transaction';
  END;

  RETURN TO_JSONB(v_bid);
END;
$$;

-- Function remains callable ONLY through the server-side service role.
REVOKE EXECUTE ON FUNCTION public.create_pending_bid(uuid, integer, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_pending_bid(uuid, integer, text, text, text, text, text, text, text, text, text) FROM ANON;
REVOKE EXECUTE ON FUNCTION public.create_pending_bid(uuid, integer, text, text, text, text, text, text, text, text, text) FROM AUTHENTICATED;
GRANT EXECUTE ON FUNCTION public.create_pending_bid(uuid, integer, text, text, text, text, text, text, text, text, text) TO SERVICE_ROLE;