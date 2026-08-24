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
