import { createClient } from '@/lib/supabase-server';
import { createServiceClient } from '@/lib/supabase-service';
import { getCategoryBySlug, validateCategory } from '@/lib/categories';
import { isEmailBanned } from '@/lib/email-bans';

export type Bid = {
  id: string;
  category_id: string;
  amount: number;
  bidder_email: string;
  bidder_name: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  status: string;
  is_highest: boolean | null;
  created_at: string;
  paid_at: string | null;
  entry_title: string | null;
  entry_description: string | null;
  entry_canonical_url: string | null;
  entry_image_url: string | null;
  entry_favicon_url: string | null;
  entry_type: 'url' | 'handle' | 'unknown' | null;
};

const BID_FIELDS =
  'id, category_id, amount, bidder_email, bidder_name, stripe_session_id, stripe_payment_intent_id, status, is_highest, created_at, paid_at, entry_title, entry_description, entry_canonical_url, entry_image_url, entry_favicon_url, entry_type';

/**
 * Get the highest paid bid for a category.
 * - Only considers status = 'paid' (per RLS/public leaderboard and indexes)
 * - Ordered by amount DESC, limit 1
 * - Returns null when no paid bids exist for the category
 * - Server-side only (uses supabase-server anon client, respects RLS)
 */
export async function getHighestBidForCategory(categoryId: string): Promise<Bid | null> {
  if (!categoryId || typeof categoryId !== 'string') {
    return null;
  }

  const normalized = categoryId.trim();

  if (!normalized) {
    return null;
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bids')
    .select(BID_FIELDS)
    .eq('category_id', normalized)
    .eq('status', 'paid')
    .order('amount', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch highest bid for category "${normalized}": ${error.message}`);
  }

  return (data as Bid | null) ?? null;
}

export type LeaderboardCategory = {
  id: string;
  slug: string;
  name: string;
};

export type LeaderboardEntry = {
  rank: number;
  bid: Bid;
  category: LeaderboardCategory | null;
};

const LEADERBOARD_CATEGORY_FIELDS = 'id, slug, name';

/**
 * Get paid bids ranked by amount DESC for the public leaderboard.
 * - Only considers status = 'paid' (per RLS/public leaderboard and indexes)
 * - Ordered amount DESC, then created_at DESC as a deterministic tie-breaker
 * - Embeds the related category (id, slug, name) via the FK relationship
 * - Optional limit (default 10); returns [] when no paid bids exist
 * - Optional categorySlug to filter by category
 * - Server-side only (uses supabase-server anon client, respects RLS)
 */
export async function getLeaderboard(
  options: { limit?: number; categorySlug?: string } = {}
): Promise<LeaderboardEntry[]> {
  const requestedLimit = options.limit;
  const categorySlug = options.categorySlug;

  const limit =
    typeof requestedLimit === 'number' && Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.floor(requestedLimit)
      : 10;

  const supabase = await createClient();

  let query = supabase
    .from('bids')
    .select(`${BID_FIELDS}, categories (${LEADERBOARD_CATEGORY_FIELDS})`)
    .eq('status', 'paid')
    .order('amount', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (categorySlug) {
    query = query.eq('categories.slug', categorySlug);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch leaderboard: ${error.message}`);
  }

  return ((data as unknown as Array<Bid & { categories: LeaderboardCategory | null }>) ?? [])
    .map((row) => ({
      rank: 0,
      bid: {
        id: row.id,
        category_id: row.category_id,
        amount: row.amount,
        bidder_email: row.bidder_email,
        bidder_name: row.bidder_name,
        stripe_session_id: row.stripe_session_id,
        stripe_payment_intent_id: row.stripe_payment_intent_id,
        status: row.status,
        is_highest: row.is_highest,
        created_at: row.created_at,
        paid_at: row.paid_at,
        entry_title: row.entry_title,
        entry_description: row.entry_description,
        entry_canonical_url: row.entry_canonical_url,
        entry_image_url: row.entry_image_url,
        entry_favicon_url: row.entry_favicon_url,
        entry_type: row.entry_type,
      },
      category: row.categories,
    }))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export type RecentBidEntry = {
  bid: Bid;
  category: LeaderboardCategory | null;
};

/**
 * Get the most recent paid bids (newest first) for the Recent Bids feed.
 * - Only considers status = 'paid' (RLS public read + app-level defense in depth)
 * - Ordered created_at DESC, then amount DESC as a deterministic tie-breaker
 * - Embeds the related category (id, slug, name) via the FK relationship
 * - Optional limit (default 10); returns [] when no paid bids exist
 * - Server-side only (uses supabase-server anon client, respects RLS)
 */
export async function getRecentBids(options: { limit?: number } = {}): Promise<RecentBidEntry[]> {
  const requestedLimit = options.limit;

  const limit =
    typeof requestedLimit === 'number' && Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.floor(requestedLimit)
      : 10;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bids')
    .select(`${BID_FIELDS}, categories (${LEADERBOARD_CATEGORY_FIELDS})`)
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .order('amount', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch recent bids: ${error.message}`);
  }

  return ((data as unknown as Array<Bid & { categories: LeaderboardCategory | null }>) ?? []).map(
    ({ categories, ...bid }) => ({
      bid,
      category: categories,
    })
  );
}

export type BidWithCategory = {
  bid: Bid;
  category: LeaderboardCategory | null;
};

/**
 * Look up a bid by its Stripe Checkout session identifier.
 * - Used by the success page (Task 4.3) to display authoritative bid/category data
 * - Respects RLS: only PAID bids are publicly readable, so a pending bid returns null
 *   until webhook confirmation converts it (callers must render a neutral state then,
 *   never a fake confirmation)
 * - The identifier originates from the URL and is treated as untrusted input
 * - Server-side only (uses supabase-server anon client; respects RLS)
 */
export async function getBidByStripeSessionId(
  stripeSessionId: string
): Promise<BidWithCategory | null> {
  if (!stripeSessionId || typeof stripeSessionId !== 'string') {
    return null;
  }

  const normalized = stripeSessionId.trim();

  if (!normalized || normalized.length > MAX_STRIPE_SESSION_ID_LENGTH) {
    return null;
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bids')
    .select(`${BID_FIELDS}, categories (${LEADERBOARD_CATEGORY_FIELDS})`)
    .eq('stripe_session_id', normalized)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch bid by session id: ${error.message}`);
  }

  const row = data as unknown as (Bid & { categories: LeaderboardCategory | null }) | null;

  if (!row) {
    return null;
  }

  const { categories, ...bid } = row;

  return { bid, category: categories };
}

/**
 * Calculate the minimum valid bid for a category with no existing paid bids.
 * Business rule: no valid bids -> minimum = category.starting_bid (server-side only).
 * - Resolves the active category by slug via the existing category query (RLS public read)
 * - Returns null when the category does not exist or is inactive
 * - Returns null when the category already has paid bids (existing-bid minimum is Task 3.2)
 * - Server-side only (uses supabase-server anon client; respects RLS; never trusts client input)
 */
export async function getInitialMinimumBid(categorySlug: string): Promise<number | null> {
  const category = await getCategoryBySlug(categorySlug);

  if (!category) {
    return null;
  }

  const highestBid = await getHighestBidForCategory(category.id);

  if (highestBid) {
    return null;
  }

  return category.starting_bid;
}

/**
 * Calculate the minimum valid bid for a category that already has a paid highest bid.
 * Business rule: existing valid bids -> minimum = highest_paid_bid.amount + category.increment
 * (server-side only; never trusts client-provided amounts).
 * - Resolves the active category by slug via the existing category query (RLS public read)
 * - Returns null when the category does not exist or is inactive
 * - Returns null when no paid bids exist yet (initial minimum is Task 3.1's getInitialMinimumBid)
 * - Server-side only (uses supabase-server anon client; respects RLS; never trusts client input)
 */
export async function getIncrementedMinimumBid(categorySlug: string): Promise<number | null> {
  const category = await getCategoryBySlug(categorySlug);

  if (!category) {
    return null;
  }

  const highestBid = await getHighestBidForCategory(category.id);

  if (!highestBid) {
    return null;
  }

  return highestBid.amount + category.increment;
}

export type MinimumBidBasis = 'first_bid' | 'maximum_plus_one';

export type MinimumBidInfo = {
  categoryId: string;
  categorySlug: string;
  minimumBid: number;
  basis: MinimumBidBasis;
};

/**
 * Determine the current minimum valid bid for a category from authoritative DB data.
 *
 * BUSINESS RULE (migration 20260823000023 - matches the create_pending_bid RPC floor):
 * - No paid bids -> minimum = $1.00 (100 cents)
 * - Existing paid highest bid -> minimum = highest.amount + $1.00
 * The configured starting_bid/increment columns no longer participate in pricing.
 * - Returns null when the category does not exist or is inactive
 * - Server-side only (uses supabase-server anon client; respects RLS); never trusts
 *   client-provided minimums or category data
 */
export async function getMinimumBidForCategory(
  categorySlug: string
): Promise<MinimumBidInfo | null> {
  const category = await getCategoryBySlug(categorySlug);

  if (!category) {
    return null;
  }

  const highestBid = await getHighestBidForCategory(category.id);

  if (!highestBid) {
    return {
      categoryId: category.id,
      categorySlug: category.slug,
      minimumBid: 100,
      basis: 'first_bid',
    };
  }

  return {
    categoryId: category.id,
    categorySlug: category.slug,
    minimumBid: highestBid.amount + 100,
    basis: 'maximum_plus_one',
  };
}

export type BidAmountValidationFailureReason =
  'invalid_amount' | 'category_not_found' | 'amount_below_minimum';

export type BidAmountValidation =
  | { valid: true; minimumBid: number; basis: MinimumBidBasis }
  | { valid: false; reason: BidAmountValidationFailureReason; minimumBid: number | null };

/**
 * Validate a proposed bid amount against the server-calculated current minimum.
 * - The amount parameter is typed `unknown` deliberately: it originates from the client,
 *   so its shape is validated at runtime regardless of any upstream typing
 * - The minimum is always recomputed from authoritative DB data via getMinimumBidForCategory;
 *   client-supplied minimums are never used
 * - Amount equal to the minimum is valid (it is exactly the required next bid)
 * - Deeper category validation is Task 3.4; pending-bid creation is Task 3.5
 */
export async function validateBidAmount(
  categorySlug: string,
  amount: unknown
): Promise<BidAmountValidation> {
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    return { valid: false, reason: 'invalid_amount', minimumBid: null };
  }

  const minimum = await getMinimumBidForCategory(categorySlug);

  if (!minimum) {
    return { valid: false, reason: 'category_not_found', minimumBid: null };
  }

  if (amount < minimum.minimumBid) {
    return { valid: false, reason: 'amount_below_minimum', minimumBid: minimum.minimumBid };
  }

  return { valid: true, minimumBid: minimum.minimumBid, basis: minimum.basis };
}

export type PendingBidInput = {
  categorySlug: unknown;
  amount: unknown;
  bidderEmail: unknown;
  bidderName?: unknown;
  stripeSessionId?: unknown;
  entryTitle?: unknown;
  entryDescription?: unknown;
  entryCanonicalUrl?: unknown;
  entryImageUrl?: unknown;
  entryFaviconUrl?: unknown;
  entryType?: unknown;
};

export type CreatePendingBidFailureReason =
  | 'invalid_slug'
  | 'category_not_found'
  | 'invalid_amount'
  | 'amount_below_minimum'
  | 'invalid_bidder_email'
  | 'banned_email'
  | 'invalid_bidder_name'
  | 'invalid_stripe_session_id'
  | 'duplicate_transaction';

export type CreatePendingBidResult =
  | { valid: true; bid: Bid }
  | { valid: false; reason: CreatePendingBidFailureReason; minimumBid: number | null };

const BIDDER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BIDDER_EMAIL_LENGTH = 254;
const MAX_BIDDER_NAME_LENGTH = 100;
const MAX_STRIPE_SESSION_ID_LENGTH = 255;

/**
 * Create a new bids row with status = 'pending' after authoritative validation.
 * - Server-side only; writes go through the service-role client because RLS grants
 *   public SELECT only (no public write policies exist by design)
 * - Never trusts client data: category is resolved from the DB via validateCategory,
 *   the amount is checked against the authoritative minimum via validateBidAmount, and
 *   the stored category_id comes from the DB row (never a client-supplied object)
 * - Concurrency (Task 3.6): the authoritative minimum re-check and the insert run inside
 *   the create_pending_bid RPC, which takes SELECT ... FOR UPDATE on the category row.
 *   Same-category bids serialize on that lock; different categories never block each
 *   other. The RPC recomputes the minimum inside the lock (accounting for pending
 *   reservations) so two simultaneous bids can never both reserve the same amount slot.
 *   The pre-validation above remains as fast-fail UX; the RPC is the source of truth.
 * - Duplicate prevention (Task 3.7): an optional stripeSessionId is stored when provided
 *   and arbitrated by the existing UNIQUE(stripe_session_id) constraint - race-safe even
 *   for simultaneous attempts, since PostgreSQL guarantees exactly one winner. A conflict
 *   surfaces as reason 'duplicate_transaction'. Absent/empty ids store NULL (multiple
 *   NULLs are distinct), keeping Task 3.5 successful behavior unchanged.
 * - The record is explicitly created as status: 'pending'; it is never marked paid or
 *   highest at creation (paid conversion happens via verified Stripe webhook in Phase 4)
 * - Contract for Task 4.1 (Stripe Checkout): expected failures return a typed union with
 *   stable reasons (minimumBid echoed on amount failures); unexpected infrastructure
 *   failures (DB errors, missing server env config) throw descriptive Errors. On success
 *   the full inserted Bid row (id, amount in integer cents, status='pending') is returned,
 *   sufficient to build the Checkout session and attach metadata later.
 */
export async function createPendingBid(input: PendingBidInput): Promise<CreatePendingBidResult> {
  const email = normalizeBidderEmail(input.bidderEmail);

  if (!email) {
    return { valid: false, reason: 'invalid_bidder_email', minimumBid: null };
  }

  // Task 8.7: fraud enforcement at the single authoritative choke point - a banned
  // email can never create a pending bid, hence never reach Checkout or payment.
  // Checked before any other validation so banned actors learn nothing about the
  // category's current state.
  if (await isEmailBanned(email)) {
    return { valid: false, reason: 'banned_email', minimumBid: null };
  }

  const nameResult = normalizeBidderName(input.bidderName);

  if (!nameResult.valid) {
    return { valid: false, reason: 'invalid_bidder_name', minimumBid: null };
  }

  const sessionIdResult = normalizeStripeSessionId(input.stripeSessionId);

  if (!sessionIdResult.valid) {
    return { valid: false, reason: 'invalid_stripe_session_id', minimumBid: null };
  }

  if (typeof input.amount !== 'number' || !Number.isInteger(input.amount)) {
    return { valid: false, reason: 'invalid_amount', minimumBid: null };
  }

  const amount = input.amount;

  const categoryValidation = await validateCategory(input.categorySlug);

  if (!categoryValidation.valid) {
    return { valid: false, reason: categoryValidation.reason, minimumBid: null };
  }

  const category = categoryValidation.category;

  const amountValidation = await validateBidAmount(category.slug, amount);

  if (!amountValidation.valid) {
    return {
      valid: false,
      reason: amountValidation.reason,
      minimumBid: amountValidation.minimumBid,
    };
  }

  const supabase = createServiceClient();

  // Atomic critical section (row lock on the category + minimum recheck + insert).
  const { data, error } = await supabase.rpc('create_pending_bid', {
    p_category_id: category.id,
    p_amount: amount,
    p_bidder_email: email,
    p_bidder_name: nameResult.name,
    p_stripe_session_id: sessionIdResult.stripeSessionId,
    p_entry_title: input.entryTitle,
    p_entry_description: input.entryDescription,
    p_entry_canonical_url: input.entryCanonicalUrl,
    p_entry_image_url: input.entryImageUrl,
    p_entry_favicon_url: input.entryFaviconUrl,
    p_entry_type: input.entryType,
  });

  if (error) {
    const mapped = mapPendingBidRpcError(error.message);

    if (mapped) {
      return mapped;
    }

    throw new Error(`Failed to create pending bid: ${error.message}`);
  }

  return { valid: true, bid: data as unknown as Bid };
}

function mapPendingBidRpcError(message: string): CreatePendingBidResult | null {
  if (!message.startsWith('bid_error:')) {
    return null;
  }

  const [, reason, extra] = message.split(':');

  if (reason === 'category_not_found') {
    return { valid: false, reason: 'category_not_found', minimumBid: null };
  }

  if (reason === 'amount_below_minimum') {
    const parsed = Number.parseInt(extra ?? '', 10);

    return {
      valid: false,
      reason: 'amount_below_minimum',
      minimumBid: Number.isNaN(parsed) ? null : parsed,
    };
  }

  if (reason === 'duplicate_transaction') {
    return { valid: false, reason: 'duplicate_transaction', minimumBid: null };
  }

  return null;
}

function normalizeBidderEmail(email: unknown): string | null {
  if (typeof email !== 'string') {
    return null;
  }

  const trimmed = email.trim();

  if (!trimmed || trimmed.length > MAX_BIDDER_EMAIL_LENGTH || !BIDDER_EMAIL_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function normalizeBidderName(
  name: unknown
): { valid: true; name: string | null } | { valid: false } {
  if (name === undefined || name === null) {
    return { valid: true, name: null };
  }

  if (typeof name !== 'string') {
    return { valid: false };
  }

  const trimmed = name.trim();

  if (!trimmed) {
    return { valid: true, name: null };
  }

  if (trimmed.length > MAX_BIDDER_NAME_LENGTH) {
    return { valid: false };
  }

  return { valid: true, name: trimmed };
}

function normalizeStripeSessionId(
  stripeSessionId: unknown
): { valid: true; stripeSessionId: string | null } | { valid: false } {
  if (stripeSessionId === undefined || stripeSessionId === null) {
    return { valid: true, stripeSessionId: null };
  }

  if (typeof stripeSessionId !== 'string') {
    return { valid: false };
  }

  const trimmed = stripeSessionId.trim();

  if (!trimmed) {
    return { valid: true, stripeSessionId: null };
  }

  if (trimmed.length > MAX_STRIPE_SESSION_ID_LENGTH) {
    return { valid: false };
  }

  return { valid: true, stripeSessionId: trimmed };
}

export type PreviousHighestBidder = {
  bidId: string;
  bidderEmail: string;
  bidderName: string | null;
  amount: number;
};

/**
 * Detect the previous highest bidder for a category (Task 6.1).
 *
 * - The previous highest bidder is the holder of the top PAID bid for the category,
 *   excluding a given bid - i.e., who was on top immediately before another bid became
 *   the new #1. Derived from authoritative paid-bid history using the established
 *   ranking semantics (amount DESC, then created_at DESC tie-breaker); nothing is stored.
 * - Returns null when no other paid bids exist (the excluded bid was the first/only one)
 *   or when inputs are blank.
 * - Server-side only (uses supabase-server anon client; RLS paid-only visibility).
 * - Consumed by Phase 6 outbid-notification tasks; refunds naturally remove a former
 *   champion from this result (never notify about a refunded payment).
 */
export async function getPreviousHighestBidder(
  categoryId: string,
  excludeBidId: string
): Promise<PreviousHighestBidder | null> {
  if (!categoryId.trim() || !excludeBidId.trim()) {
    return null;
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bids')
    .select(BID_FIELDS)
    .eq('category_id', categoryId)
    .eq('status', 'paid')
    .neq('id', excludeBidId)
    .order('amount', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch previous highest bidder: ${error.message}`);
  }

  const row = data as Bid | null;

  if (!row) {
    return null;
  }

  return {
    bidId: row.id,
    bidderEmail: row.bidder_email,
    bidderName: row.bidder_name,
    amount: row.amount,
  };
}
