interface LeaderboardEntry {
  rank: number;
  bidderName: string;
  bidderEmail: string;
  category: string;
  amount: number;
  timeAgo: string;
}

const mockLeaderboard: LeaderboardEntry[] = [
  {
    rank: 1,
    bidderName: 'Alex Chen',
    bidderEmail: 'alex.c@example.com',
    category: 'Automotive',
    amount: 250000,
    timeAgo: '2 min ago',
  },
  {
    rank: 2,
    bidderName: 'Sarah M.',
    bidderEmail: 'sarah.m@example.com',
    category: 'Art & Collectibles',
    amount: 125000,
    timeAgo: '15 min ago',
  },
  {
    rank: 3,
    bidderName: 'James K.',
    bidderEmail: 'james.k@example.com',
    category: 'Fashion & Accessories',
    amount: 78000,
    timeAgo: '1 hour ago',
  },
  {
    rank: 4,
    bidderName: 'Priya R.',
    bidderEmail: 'priya.r@example.com',
    category: 'Sports Memorabilia',
    amount: 52000,
    timeAgo: '3 hours ago',
  },
  {
    rank: 5,
    bidderName: 'Marcus T.',
    bidderEmail: 'marcus.t@example.com',
    category: 'Tech & Gadgets',
    amount: 45000,
    timeAgo: '5 hours ago',
  },
  {
    rank: 6,
    bidderName: 'Elena V.',
    bidderEmail: 'elena.v@example.com',
    category: 'Digital Assets',
    amount: 35000,
    timeAgo: '8 hours ago',
  },
];

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function getRankBadge(rank: number) {
  if (rank === 1) return 'bg-warning text-warning-foreground';
  if (rank === 2)
    return 'bg-neutral-300 dark:bg-neutral-600 text-neutral-900 dark:text-neutral-100';
  if (rank === 3) return 'bg-amber-800 text-amber-50';
  return 'bg-muted text-muted-foreground';
}

export default function Leaderboard() {
  return (
    <section className="py-12 sm:py-16 lg:py-20" aria-labelledby="leaderboard-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="text-center max-w-2xl mx-auto mb-12">
          <h2
            id="leaderboard-heading"
            className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight"
          >
            Top Bidders Leaderboard
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Current highest bids across all categories. Updated in real-time.
          </p>
        </header>

        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <table className="w-full" role="table" aria-label="Top bidders leaderboard">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th
                  scope="col"
                  className="px-4 sm:px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                >
                  Rank
                </th>
                <th
                  scope="col"
                  className="px-4 sm:px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                >
                  Bidder
                </th>
                <th
                  scope="col"
                  className="px-4 sm:px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                >
                  Category
                </th>
                <th
                  scope="col"
                  className="px-4 sm:px-6 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                >
                  Bid Amount
                </th>
                <th
                  scope="col"
                  className="px-4 sm:px-6 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                >
                  Time
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {mockLeaderboard.map((entry) => (
                <tr
                  key={entry.rank}
                  className={`transition-colors hover:bg-muted/50 ${
                    entry.rank === 1 ? 'bg-primary/5 border-l-4 border-warning' : ''
                  }`}
                >
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm ${getRankBadge(entry.rank)}`}
                    >
                      {entry.rank === 1 ? (
                        <>
                          <span className="sr-only">First place </span>#1
                        </>
                      ) : (
                        entry.rank
                      )}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-medium text-primary">
                          {entry.bidderName.charAt(0)}
                        </span>
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{entry.bidderName}</div>
                        <div className="text-xs text-muted-foreground">{entry.bidderEmail}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                      {entry.category}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-right">
                    <span
                      className={`font-bold text-lg ${entry.rank === 1 ? 'text-warning' : 'text-foreground'}`}
                    >
                      {formatCurrency(entry.amount)}
                    </span>
                    {entry.rank === 1 && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning/10 text-warning">
                        Highest Bid
                      </span>
                    )}
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-right text-sm text-muted-foreground">
                    {entry.timeAgo}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 text-center">
          <a
            href="/leaderboard"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-6 py-3 text-foreground font-medium text-base transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            View Full Leaderboard
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 8l4 4m0 0l-4 4m4-4H3"
              />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
