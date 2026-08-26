'use client';

import { useState } from 'react';

import { getLeaderboardPage, type LeaderboardPageEntry } from '@/lib/bids-client';

/**
 * Paginated authoritative leaderboard for the console UX (UI redesign task).
 *
 * - Page size 50; page 1 arrives server-rendered (bounded), later pages are fetched
 *   through the same bounded range query - never an unbounded dataset.
 * - Privacy: rows carry NO email by construction (the paginated query does not select
 *   bidder_email); identity renders as the display name or "Anonymous bidder".
 * - Ranking order is the existing authoritative one (amount DESC, created_at DESC).
 */
export const LEADERBOARD_PAGE_SIZE = 50;

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

type PageState = {
  entries: LeaderboardPageEntry[];
  offset: number;
  hasMore: boolean;
};

export default function LeaderboardTable({
  initialEntries,
}: {
  initialEntries: LeaderboardPageEntry[];
}) {
  const [page, setPage] = useState<PageState>({
    entries: initialEntries,
    offset: 0,
    hasMore: initialEntries.length === LEADERBOARD_PAGE_SIZE,
  });
  const [pending, setPending] = useState(false);

  async function goToOffset(offset: number) {
    if (pending || offset < 0) return;

    setPending(true);

    try {
      const result = await getLeaderboardPage(offset, LEADERBOARD_PAGE_SIZE);

      setPage({ entries: result.entries, offset, hasMore: result.hasMore });
    } catch (error) {
      // Surface the real failure during development instead of showing a fake-empty
      // page; the user keeps the current page and can retry the same offset.
      console.error('[leaderboard] page load failed', error);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="py-12 sm:py-16" aria-labelledby="leaderboard-heading">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <h2
          id="leaderboard-heading"
          className="text-center text-2xl sm:text-3xl font-bold text-foreground tracking-tight"
        >
          Top Bidders
        </h2>

        <div className="mt-8 rounded-xl border border-border bg-background">
          {page.entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground" role="status">
              No paid bids yet — the leaderboard fills in as soon as the first payment is verified.
              Place a $1 bid above to start it off.
            </p>
          ) : (
            <ol className="divide-y divide-border" role="list">
              {page.entries.map((entry, index) => {
                const rank = page.offset + index + 1;

                return (
                  <li key={entry.id} className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
                    <span
                      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        rank === 1
                          ? 'bg-warning text-warning-foreground'
                          : rank <= 3
                            ? 'bg-primary/15 text-primary'
                            : 'bg-muted text-muted-foreground'
                      }`}
                      aria-label={`Rank ${rank}`}
                    >
                      {rank}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {entry.entryTitle ?? entry.bidderName ?? 'Anonymous bidder'}
                        </span>
                        {entry.entryType && entry.entryType !== 'unknown' && (
                          <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {entry.entryType}
                          </span>
                        )}
                      </div>
                      {(entry.entryDescription || entry.entryCanonicalUrl) && (
                        <div className="truncate text-xs text-muted-foreground">
                          {entry.entryDescription}
                          {entry.entryCanonicalUrl && entry.entryDescription ? ' — ' : ''}
                          {entry.entryCanonicalUrl}
                        </div>
                      )}
                    </div>

                    {entry.category ? (
                      <span className="hidden shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground sm:inline">
                        {entry.category.name}
                      </span>
                    ) : null}

                    <span className="shrink-0 font-semibold text-primary">
                      {formatCurrency(entry.amount)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {(page.offset > 0 || page.hasMore) && page.entries.length > 0 ? (
          <nav
            className="mt-6 flex items-center justify-between gap-4"
            aria-label="Leaderboard pages"
          >
            <button
              type="button"
              onClick={() => void goToOffset(page.offset - LEADERBOARD_PAGE_SIZE)}
              disabled={pending || page.offset === 0}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-xs text-muted-foreground">
              Ranks {page.offset + 1}–{page.offset + page.entries.length}
            </span>
            <button
              type="button"
              onClick={() => void goToOffset(page.offset + LEADERBOARD_PAGE_SIZE)}
              disabled={pending || !page.hasMore}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </nav>
        ) : null}
      </div>
    </section>
  );
}
