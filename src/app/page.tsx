import BidConsole from '@/components/BidConsole';
import LeaderboardTable, { LEADERBOARD_PAGE_SIZE } from '@/components/LeaderboardTable';
import RecentBids from '@/components/RecentBids';
import { getLeaderboard } from '@/lib/bids';
import type { LeaderboardPageEntry } from '@/lib/bids-client';

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
export default async function Home() {
  let initialEntries: LeaderboardPageEntry[] = [];

  try {
    const leaderboard = await getLeaderboard({ limit: LEADERBOARD_PAGE_SIZE });

    initialEntries = leaderboard.map((entry) => ({
      id: entry.bid.id,
      amount: entry.bid.amount,
      bidderName: entry.bid.bidder_name,
      createdAt: entry.bid.created_at,
      category: entry.category,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`[home] leaderboard query failed: ${message}`);
  }

  return (
    <>
      <BidConsole />
      <LeaderboardTable initialEntries={initialEntries} />
      <RecentBids />
    </>
  );
}
