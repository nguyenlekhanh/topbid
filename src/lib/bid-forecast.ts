import { createClient } from '@/lib/supabase-server';
import { validateCategory } from '@/lib/categories';

/**
 * Position FORECAST for the bid console preview (informational only).
 *
 * Derived deterministically from the SAME database data and ordering the leaderboard
 * uses (paid bids, amount DESC, created_at DESC tie-breaker) and the SAME next-bid
 * rule the create_pending_bid RPC enforces under lock (migration 20260823000023):
 *
 *   next amount = current maximum RESERVATION + $1 (100 cents)
 *   $1 when there are no reservations in scope
 *
 * Scope follows the checkout rules: a selected category narrows the floor to that
 * category, while rank/total are always reported against the GLOBAL live board.
 *
 * THIS IS PRESENTATIONAL ONLY. The forecast never authorizes anything - when the
 * checkout is actually created, create_pending_bid recomputes the floor inside its
 * row lock and Stripe receives only that server-derived amount.
 */

export type BidForecast = {
  /** Authoritative next amount in cents (max reservation + $1, or $1 when empty). */
  nextAmountCents: number;
  /** Projected rank on the GLOBAL live board for a bid at nextAmountCents. */
  projectedRank: number;
  /** Number of paid bids currently visible on the global live board. */
  totalPaidBids: number;
  /** Current top paid amount across the board (null when empty). */
  currentTopCents: number | null;
};

const MAX_FLOOR_ROWS = 1000; // sanity bound; far above MVP board sizes

export async function getBidForecast(options: { categorySlug?: unknown }): Promise<BidForecast> {
  const slug = typeof options.categorySlug === 'string' ? options.categorySlug.trim() : '';

  let scopedCategoryId: string | null = null;

  if (slug) {
    const validation = await validateCategory(slug);

    // Unknown/inactive categories cannot be bid on; report the GLOBAL picture rather
    // than inventing numbers for them.
    if (validation.valid) {
      scopedCategoryId = validation.category.id;
    }
  }

  const supabase = await createClient();

  async function amountsByStatus(
    status: 'paid' | 'pending',
    categoryId: string | null,
    single: boolean
  ): Promise<number[]> {
    let query = supabase
      .from('bids')
      .select(single ? 'amount' : 'amount')
      .eq('status', status)
      .order('amount', { ascending: false });

    if (!single) {
      query = query.limit(MAX_FLOOR_ROWS);
    }

    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    if (single) {
      const { data, error } = await query.maybeSingle();

      if (error) {
        throw new Error(`Failed to load ${status} top bid for forecast: ${error.message}`);
      }

      return (data as unknown as { amount: number } | null)?.amount != null
        ? [(data as unknown as { amount: number }).amount]
        : [];
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to load ${status} bids for forecast: ${error.message}`);
    }

    return ((data as unknown as Array<{ amount: number }>) ?? []).map((row) => row.amount);
  }

  // Read order matters for tests only; every read is independent and bounded.
  const pendingTop = await amountsByStatus('pending', scopedCategoryId, true);
  const globalPaid = await amountsByStatus('paid', null, false);
  const scopedPaid = scopedCategoryId ? await amountsByStatus('paid', scopedCategoryId, false) : [];

  const reservations = scopedCategoryId ? scopedPaid : globalPaid;
  const pendingMax = pendingTop.length ? pendingTop[0] : null;
  const reservationMax = reservations.length ? Math.max(...reservations) : null;

  const hasReservations = reservationMax !== null || pendingMax !== null;
  const nextAmountCents = hasReservations
    ? Math.max(reservationMax ?? 0, pendingMax ?? 0) + 100
    : 100;

  // Projected GLOBAL rank: equal amounts sort newest-first, so only strictly higher
  // amounts rank ahead of the brand-new bid.
  const projectedRank = globalPaid.filter((amount) => amount >= nextAmountCents).length + 1;

  return {
    nextAmountCents,
    projectedRank,
    totalPaidBids: globalPaid.length,
    currentTopCents: globalPaid.length ? Math.max(...globalPaid) : null,
  };
}
