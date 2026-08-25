'use client';

import { useCallback, useEffect, useState } from 'react';

import { EmptyRecentBids } from '@/components/EmptyState';
import { RecentBidsError } from '@/components/ErrorState';
import { getRecentBidEntries, type RecentBidEntryData } from '@/lib/bids-client';
import { createRecentBidsTracker } from '@/lib/recent-bids-tracker';
import { subscribeToBidChanges } from '@/lib/realtime';

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

function getTimeAgo(createdAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;

  return `${Math.floor(seconds / 86400)} days ago`;
}

export default function RecentBids() {
  const [entries, setEntries] = useState<RecentBidEntryData[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const fetched = await getRecentBidEntries();

      setEntries(fetched);
      setLoadFailed(false);
    } catch (error) {
      console.error('[recent-bids] failed to load recent bids', error);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    // Task 5.4: realtime events are signals only - the tracker performs the initial
    // authoritative load and re-fetches on every change (RLS paid-only via anon client),
    // notifying this component through its callback.
    return createRecentBidsTracker({
      subscribe: subscribeToBidChanges,
      fetchRecentBids: getRecentBidEntries,
      onRecentBidsChange: (updated) => {
        setEntries(updated);
        setLoadFailed(false);
      },
      onError: () => setLoadFailed(true),
    });
  }, []);

  const displayEntries = (entries ?? []).map((bid) => ({
    ...bid,
    bidderName: bid.bidderName ?? 'Anonymous bidder',
    category: bid.category?.name ?? 'General',
    timeAgo: getTimeAgo(bid.createdAt),
  }));

  if (loadFailed && entries === null) {
    return (
      <section
        className="py-12 sm:py-16 lg:py-20 bg-muted/20 border-y border-border"
        aria-labelledby="recent-bids-heading"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <RecentBidsError onRetry={() => void refresh()} />
        </div>
      </section>
    );
  }

  if (entries !== null && entries.length === 0) {
    return (
      <section
        className="py-12 sm:py-16 lg:py-20 bg-muted/20 border-y border-border"
        aria-labelledby="recent-bids-heading"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <EmptyRecentBids />
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
        <header className="mb-8">
          <div>
            <h2
              id="recent-bids-heading"
              className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight"
            >
              Recent Bids
            </h2>
            <p className="mt-2 text-base text-muted-foreground">
              Live feed — newest paid bids first, straight from the leaderboard database.
            </p>
          </div>
        </header>

        <div className="overflow-hidden rounded-xl border border-border bg-background">
          <ul role="list" className="divide-y divide-border">
            {displayEntries.map((bid) => (
              <li
                key={bid.id}
                className="group flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 hover:bg-muted/50 transition-colors duration-200 ease-out focus-within:bg-muted/50 motion-reduce:transition-none"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div
                    className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                    aria-hidden="true"
                  >
                    {getInitials(bid.bidderName ?? bid.bidderEmail)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground truncate">{bid.bidderName}</span>
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {bid.category ?? 'General'}
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
                    Paid
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {entries === null && (
            <p className="px-4 sm:p-5 text-sm text-muted-foreground" role="status">
              Loading recent bids…
            </p>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Showing {(entries ?? []).length} most recent bids • Updated in real-time.
        </p>
      </div>
    </section>
  );
}
