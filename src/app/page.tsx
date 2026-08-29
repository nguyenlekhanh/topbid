import BidConsole from '@/components/BidConsole';
import LeaderboardTable, { LEADERBOARD_PAGE_SIZE } from '@/components/LeaderboardTable';
import RecentBids from '@/components/RecentBids';
import { getLeaderboard } from '@/lib/bids';
import type { LeaderboardPageEntry } from '@/lib/bids-client';

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Homepage (UI redesign task): full-screen centered bidding console with the
 * paginated authoritative leaderboard below it.
 *
 * Page 1 of the leaderboard is server-rendered from the SAME authoritative query the
 * rest of the app uses (paid bids, amount DESC, created_at DESC, RLS-filtered), then
 * paginated client-side in bounded 50-row pages. The section keeps the
 * leaderboard-heading anchor that public share URLs target.
 *
 * Query failures are surfaced loudly in the server logs and degrade to an empty page-1
 * (with its explicit empty state) so the bid console always renders - the failure is
 * never silently disguised as "no bids exist".
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category: categorySlug } = await searchParams;
  const selectedCategory = categorySlug ?? null;

  let initialEntries: LeaderboardPageEntry[] = [];
  let topBidAmount = 0;

  try {
    const leaderboard = await getLeaderboard({
      limit: LEADERBOARD_PAGE_SIZE,
      categorySlug: selectedCategory ?? undefined,
    });

    topBidAmount = leaderboard.length > 0 ? leaderboard[0].bid.amount : 0;

    initialEntries = leaderboard.map((entry) => ({
      id: entry.bid.id,
      amount: entry.bid.amount,
      bidderName: entry.bid.bidder_name,
      createdAt: entry.bid.created_at,
      category: entry.category,
      entryTitle: entry.bid.entry_title,
      entryDescription: entry.bid.entry_description,
      entryCanonicalUrl: entry.bid.entry_canonical_url,
      entryImageUrl: entry.bid.entry_image_url,
      entryFaviconUrl: entry.bid.entry_favicon_url,
      entryType: entry.bid.entry_type,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`[home] leaderboard query failed: ${message}`);
  }

  return (
    <>
      {topBidAmount > 0 && (
        <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 mb-8">
          <div className="rounded-xl border border-border bg-background p-4 sm:p-6">
            <p className="text-center text-lg font-medium text-foreground">
              Claim #1 for {formatCurrency(topBidAmount)}
            </p>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              New spots start at $1. Paying less than the #1 price still puts you on the board at
              whatever place that bid can take.
            </p>
          </div>
        </div>
      )}
      <BidConsole />
      <LeaderboardTable
        initialEntries={initialEntries}
        categorySlug={selectedCategory ?? undefined}
      />
      <RecentBids />
    </>
  );
}
