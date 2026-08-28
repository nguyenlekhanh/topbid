'use client';

import { useState } from 'react';

import { getLeaderboardPage, type LeaderboardPageEntry } from '@/lib/bids-client';
import BidIcon from '@/components/BidIcon';

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

function getProductValue(entry: LeaderboardPageEntry): string {
  if (entry.entryType === 'handle') {
    return entry.entryTitle ?? '';
  }
  if (entry.entryType === 'url') {
    return entry.entryCanonicalUrl ?? entry.entryTitle ?? '';
  }
  return entry.entryTitle ?? '';
}

type PageState = {
  entries: LeaderboardPageEntry[];
  offset: number;
  hasMore: boolean;
};

type ClaimState = {
  loading: boolean;
  entryId: string | null;
};

export default function LeaderboardTable({
  initialEntries,
  categorySlug,
}: {
  initialEntries: LeaderboardPageEntry[];
  categorySlug?: string;
}) {
  const [page, setPage] = useState<PageState>({
    entries: initialEntries,
    offset: 0,
    hasMore: initialEntries.length === LEADERBOARD_PAGE_SIZE,
  });
  const [pending, setPending] = useState(false);
  const [claimState, setClaimState] = useState<ClaimState>({ loading: false, entryId: null });

  async function goToOffset(offset: number) {
    if (pending || offset < 0) return;

    setPending(true);

    try {
      const result = await getLeaderboardPage(offset, LEADERBOARD_PAGE_SIZE, categorySlug);

      setPage({ entries: result.entries, offset, hasMore: result.hasMore });
    } catch (error) {
      console.error('[leaderboard] page load failed', error);
    } finally {
      setPending(false);
    }
  }

  async function handleClaimClick(entry: LeaderboardPageEntry) {
    const productValue = getProductValue(entry);
    const categorySlug = entry.category?.slug;

    if (!productValue) {
      return;
    }

    setClaimState({ loading: true, entryId: entry.id });

    try {
      const response = await fetch('/api/bids/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: productValue, categorySlug }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error === 'amount_below_minimum' && data.minimumBid) {
          alert(
            `Minimum bid is now ${formatCurrency(data.minimumBid)}. Please refresh and try again.`
          );
        } else if (data.error === 'duplicate_transaction') {
          alert('This bid was already processed. Please refresh the leaderboard.');
        } else {
          alert(`Failed to create checkout: ${data.error}`);
        }
        return;
      }

      if (data.url) {
        window.open(data.url, '_self');
      }
    } catch (error) {
      console.error('[leaderboard] claim failed', error);
      alert('Failed to create checkout session. Please try again.');
    } finally {
      setClaimState({ loading: false, entryId: null });
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
                const claimAmountCents = entry.amount + 100;
                const isClaimLoading = claimState.loading && claimState.entryId === entry.id;

                return (
                  <li
                    key={entry.id}
                    className="group relative cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleClaimClick(entry);
                      }}
                      disabled={isClaimLoading}
                      className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 z-10 bg-background border border-border rounded-[4px] px-3 py-1 text-xs font-medium text-primary whitespace-nowrap shadow-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-150 hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label={`Next bid: ${formatCurrency(claimAmountCents)}`}
                    >
                      {isClaimLoading
                        ? 'Claiming...'
                        : `Claim for ${formatCurrency(claimAmountCents)}`}
                    </button>
                    <a
                      href={`/next/${entry.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6 w-full block"
                    >
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

                      <BidIcon
                        entryFaviconUrl={entry.entryFaviconUrl}
                        entryImageUrl={entry.entryImageUrl}
                        entryType={entry.entryType}
                        size={24}
                      />

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
                    </a>
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
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </nav>
        ) : null}
      </div>
    </section>
  );
}
