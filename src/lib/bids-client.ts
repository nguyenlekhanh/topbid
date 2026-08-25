import { createClient } from '@/lib/supabase';

/**
 * Browser-safe bid queries (anon client, RLS paid-only visibility).
 *
 * Lives separately from ./bids because that module pulls in server-only
 * service-role/Stripe paths that must never enter the browser bundle.
 */

export async function getHighestPaidBidAmountForCategory(
  categoryId: string
): Promise<number | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('bids')
    .select('amount')
    .eq('category_id', categoryId)
    .eq('status', 'paid')
    .order('amount', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch highest paid bid amount: ${error.message}`);
  }

  return (data as { amount: number } | null)?.amount ?? null;
}

export type LeaderboardEntryData = {
  id: string;
  amount: number;
  bidderName: string | null;
  bidderEmail: string;
  createdAt: string;
  category: { id: string; slug: string; name: string } | null;
};

/**
 * Authoritative leaderboard ranking for browsers (Task 5.3).
 * Mirrors the server-side getLeaderboard(): paid bids ranked amount DESC with
 * created_at DESC tie-breaker, RLS-filtered to paid rows for anon clients.
 */
export async function getLeaderboardEntries(limit = 10): Promise<LeaderboardEntryData[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('bids')
    .select('id, amount, bidder_name, bidder_email, created_at, categories (id, slug, name)')
    .eq('status', 'paid')
    .order('amount', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch leaderboard: ${error.message}`);
  }

  return ((data as unknown as Array<Record<string, unknown>>) ?? []).map((row) => ({
    id: String(row.id),
    amount: Number(row.amount),
    bidderName: (row.bidder_name as string | null) ?? null,
    bidderEmail: String(row.bidder_email),
    createdAt: String(row.created_at),
    category:
      row.categories && !Array.isArray(row.categories)
        ? {
            id: String((row.categories as Record<string, unknown>).id),
            slug: String((row.categories as Record<string, unknown>).slug),
            name: String((row.categories as Record<string, unknown>).name),
          }
        : null,
  }));
}

export type RecentBidEntryData = {
  id: string;
  amount: number;
  bidderName: string | null;
  bidderEmail: string;
  createdAt: string;
  category: { id: string; slug: string; name: string } | null;
};

/**
 * Authoritative recent-bids feed for browsers (Task 5.4).
 * Mirrors the server-side getRecentBids(): paid bids newest-first (created_at DESC)
 * with amount DESC tie-breaker, RLS-filtered to paid rows for anon clients.
 */
export async function getRecentBidEntries(limit = 8): Promise<RecentBidEntryData[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('bids')
    .select('id, amount, bidder_name, bidder_email, created_at, categories (id, slug, name)')
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .order('amount', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch recent bids: ${error.message}`);
  }

  return ((data as unknown as Array<Record<string, unknown>>) ?? []).map((row) => ({
    id: String(row.id),
    amount: Number(row.amount),
    bidderName: (row.bidder_name as string | null) ?? null,
    bidderEmail: String(row.bidder_email),
    createdAt: String(row.created_at),
    category:
      row.categories && !Array.isArray(row.categories)
        ? {
            id: String((row.categories as Record<string, unknown>).id),
            slug: String((row.categories as Record<string, unknown>).slug),
            name: String((row.categories as Record<string, unknown>).name),
          }
        : null,
  }));
}

export type LeaderboardPageEntry = {
  id: string;
  amount: number;
  bidderName: string | null;
  createdAt: string;
  category: { id: string; slug: string; name: string } | null;
};

/**
 * Bounded leaderboard pagination for the console UX (UI redesign task).
 * Same authoritative ordering as getLeaderboardEntries (amount DESC, created_at DESC
 * tie-breaker) with server-side range slicing - never an unbounded fetch. bidder_email
 * is deliberately NOT selected: the public leaderboard must not transport it.
 */
export async function getLeaderboardPage(
  offset: number,
  limit: number
): Promise<{
  entries: LeaderboardPageEntry[];
  hasMore: boolean;
}> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('bids')
    .select('id, amount, bidder_name, created_at, categories (id, slug, name)')
    .eq('status', 'paid')
    .order('amount', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to fetch leaderboard page: ${error.message}`);
  }

  const rows = (data as unknown as Array<Record<string, unknown>>) ?? [];
  // A full page hints there may be more; one extra row beyond the window proves it
  // without a separate count query.
  const hasMore = rows.length > limit;
  const entries = rows.slice(0, limit).map((row) => ({
    id: String(row.id),
    amount: Number(row.amount),
    bidderName: (row.bidder_name as string | null) ?? null,
    createdAt: String(row.created_at),
    category:
      row.categories && !Array.isArray(row.categories)
        ? {
            id: String((row.categories as Record<string, unknown>).id),
            slug: String((row.categories as Record<string, unknown>).slug),
            name: String((row.categories as Record<string, unknown>).name),
          }
        : null,
  }));

  return { entries, hasMore };
}

export type CategoryOption = { slug: string; name: string };

/**
 * Active category options for the console dropdown (RLS active-only via anon client).
 */
export async function getActiveCategoryOptions(): Promise<CategoryOption[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('categories')
    .select('slug, name')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to list category options: ${error.message}`);
  }

  return ((data as unknown as Array<{ slug: string; name: string }>) ?? []).map((row) => ({
    slug: String(row.slug),
    name: String(row.name),
  }));
}
