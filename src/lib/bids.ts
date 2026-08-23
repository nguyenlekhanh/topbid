import { createClient } from '@/lib/supabase-server';
import { getCategoryBySlug } from '@/lib/categories';

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
};

const BID_FIELDS =
  'id, category_id, amount, bidder_email, bidder_name, stripe_session_id, stripe_payment_intent_id, status, is_highest, created_at, paid_at';

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
 * - Server-side only (uses supabase-server anon client, respects RLS)
 */
export async function getLeaderboard(
  options: { limit?: number } = {}
): Promise<LeaderboardEntry[]> {
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
    .order('amount', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

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

export type MinimumBidBasis = 'starting_bid' | 'highest_bid_plus_increment';

export type MinimumBidInfo = {
  categoryId: string;
  categorySlug: string;
  minimumBid: number;
  basis: MinimumBidBasis;
};

/**
 * Determine the current minimum valid bid for a category from authoritative DB data.
 * - No paid bids -> minimum = category.starting_bid
 * - Existing paid highest bid -> minimum = highest_bid.amount + category.increment
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
      minimumBid: category.starting_bid,
      basis: 'starting_bid',
    };
  }

  return {
    categoryId: category.id,
    categorySlug: category.slug,
    minimumBid: highestBid.amount + category.increment,
    basis: 'highest_bid_plus_increment',
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
