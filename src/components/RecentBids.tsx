interface RecentBid {
  id: string;
  bidderName: string;
  bidderEmail: string;
  category: string;
  amount: number;
  timeAgo: string;
}

const mockRecentBids: RecentBid[] = [
  {
    id: '1',
    bidderName: 'Alex Chen',
    bidderEmail: 'alex.c@example.com',
    category: 'Automotive',
    amount: 250000,
    timeAgo: 'Just now',
  },
  {
    id: '2',
    bidderName: 'Jamie L.',
    bidderEmail: 'jamie.l@example.com',
    category: 'Tech & Gadgets',
    amount: 47500,
    timeAgo: '3 min ago',
  },
  {
    id: '3',
    bidderName: 'Riley K.',
    bidderEmail: 'riley.k@example.com',
    category: 'Art & Collectibles',
    amount: 130000,
    timeAgo: '8 min ago',
  },
  {
    id: '4',
    bidderName: 'Sam P.',
    bidderEmail: 'sam.p@example.com',
    category: 'Digital Assets',
    amount: 36200,
    timeAgo: '12 min ago',
  },
  {
    id: '5',
    bidderName: 'Morgan D.',
    bidderEmail: 'morgan.d@example.com',
    category: 'Fashion & Accessories',
    amount: 81000,
    timeAgo: '24 min ago',
  },
  {
    id: '6',
    bidderName: 'Taylor W.',
    bidderEmail: 'taylor.w@example.com',
    category: 'Sports Memorabilia',
    amount: 53500,
    timeAgo: '41 min ago',
  },
  {
    id: '7',
    bidderName: 'Casey J.',
    bidderEmail: 'casey.j@example.com',
    category: 'Automotive',
    amount: 245000,
    timeAgo: '1 hour ago',
  },
  {
    id: '8',
    bidderName: 'Avery M.',
    bidderEmail: 'avery.m@example.com',
    category: 'Tech & Gadgets',
    amount: 45200,
    timeAgo: '2 hours ago',
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

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function RecentBids() {
  if (mockRecentBids.length === 0) {
    return (
      <section className="py-12 sm:py-16 lg:py-20" aria-labelledby="recent-bids-heading">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
            <h2 id="recent-bids-heading" className="text-lg font-semibold text-foreground">
              No recent bids yet
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">Be the first to place a bid.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="py-12 sm:py-16 lg:py-20 bg-muted/20 border-y border-border"
      aria-labelledby="recent-bids-heading"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mb-8">
          <div>
            <h2
              id="recent-bids-heading"
              className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight"
            >
              Recent Bids
            </h2>
            <p className="mt-2 text-base text-muted-foreground">
              Live feed — newest bids first. Mock data for UI preview.
            </p>
          </div>
          <a
            href="/bids"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md self-start sm:self-auto"
          >
            View all
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </header>

        <div className="overflow-hidden rounded-xl border border-border bg-background">
          <ul role="list" className="divide-y divide-border">
            {mockRecentBids.map((bid) => (
              <li
                key={bid.id}
                className="group flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 hover:bg-muted/50 transition-colors focus-within:bg-muted/50"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div
                    className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                    aria-hidden="true"
                  >
                    {getInitials(bid.bidderName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground truncate">{bid.bidderName}</span>
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {bid.category}
                      </span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <time className="text-xs text-muted-foreground" dateTime={bid.timeAgo}>
                        {bid.timeAgo}
                      </time>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {bid.bidderEmail}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 pl-0 sm:pl-4">
                  <span className="text-lg sm:text-xl font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">
                    {formatCurrency(bid.amount)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-success bg-success/10 px-2 py-1 rounded-full">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-success animate-pulse"
                      aria-hidden="true"
                    />
                    New
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Showing {mockRecentBids.length} most recent bids • Updates are mock, no realtime yet.
        </p>
      </div>
    </section>
  );
}
