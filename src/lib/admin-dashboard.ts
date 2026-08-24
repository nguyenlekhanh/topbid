import { listCategories } from '@/lib/categories';
import { getLeaderboard, getRecentBids } from '@/lib/bids';

/**
 * Admin dashboard overview loader (Task 8.2).
 *
 * Composes EXISTING RLS-safe queries (listCategories, getLeaderboard, getRecentBids -
 * active-only categories and PAID-only bids under row level security) into the
 * dashboard's view model. Three independent queries run in parallel; no new SQL, no
 * service-role access, no N+1.
 *
 * Privacy by construction: the view-model types expose ONLY display-safe fields.
 * Bidder emails, Stripe session/payment identifiers, and internal bid ids are absent
 * from the returned shapes entirely, so no rendered markup can leak them.
 *
 * Deliberately omitted metrics (not cleanly available via public RLS; creating
 * privileged queries was rejected for this foundation task): inactive-category
 * counts, pending-bid counts/reservations, payment-failure summaries.
 *
 * Server-only module: database reads belong to the request path, never the browser.
 */

export type AdminTopBid = {
  rank: number;
  categoryName: string | null;
  bidderName: string | null;
  amountCents: number;
};

export type AdminRecentBid = {
  bidderName: string | null;
  categoryName: string | null;
  amountCents: number;
  createdAt: string;
};

export type AdminOverview = {
  activeCategoryCount: number;
  topBids: AdminTopBid[];
  recentBids: AdminRecentBid[];
};

const DASHBOARD_LIMIT = 10;

export async function loadAdminOverview(): Promise<AdminOverview> {
  const [categories, leaderboard, recent] = await Promise.all([
    listCategories(),
    getLeaderboard({ limit: DASHBOARD_LIMIT }),
    getRecentBids({ limit: DASHBOARD_LIMIT }),
  ]);

  return {
    activeCategoryCount: categories.length,
    topBids: leaderboard.map((entry) => ({
      rank: entry.rank,
      categoryName: entry.category?.name ?? null,
      bidderName: entry.bid.bidder_name,
      amountCents: entry.bid.amount,
    })),
    recentBids: recent.map(({ bid, category }) => ({
      bidderName: bid.bidder_name,
      categoryName: category?.name ?? null,
      amountCents: bid.amount,
      createdAt: bid.created_at,
    })),
  };
}
