'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { EmptyLeaderboard } from '@/components/EmptyState';
import { LeaderboardError } from '@/components/ErrorState';
import { getLeaderboardEntries, type LeaderboardEntryData } from '@/lib/bids-client';
import { createLeaderboardTracker } from '@/lib/leaderboard-tracker';
import { detectRankChanges, type RankDirection } from '@/lib/rank-changes';
import { subscribeToBidChanges } from '@/lib/realtime';

type LeaderboardRow = LeaderboardEntryData & { rank: number };

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function getTimeAgo(createdAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;

  return `${Math.floor(seconds / 86400)} days ago`;
}

function getRankBadge(rank: number) {
  if (rank === 1) return 'bg-warning text-warning-foreground';
  if (rank === 2)
    return 'bg-neutral-300 dark:bg-neutral-600 text-neutral-900 dark:text-neutral-100';
  if (rank === 3) return 'bg-amber-800 text-amber-50';
  return 'bg-muted text-muted-foreground';
}

function getRankChangeClass(change: RankDirection | undefined): string {
  // Task 5.5: purely visual movement cues - up-movers settle from above, down/new rows
  // fade in from below. motion-safe prefixes plus the global reduced-motion override
  // keep animations off for users who prefer reduced motion.
  if (change === 'up') return 'motion-safe:animate-[slideDown_450ms_ease-out]';
  if (change === 'down' || change === 'new') return 'motion-safe:animate-[fadeInUp_450ms_ease-out]';
  return '';
}

export default function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rankChanges, setRankChanges] = useState<Map<string, RankDirection>>(new Map());

  // Previous committed ranking, used solely inside callbacks/effects (never during render)
  // to compute Task 5.5 movement directions.
  const previousRowsRef = useRef<LeaderboardRow[] | null>(null);

  const applyRows = useCallback((updated: LeaderboardEntryData[]) => {
    const next = updated.map((entry, index) => ({ ...entry, rank: index + 1 }));

    setRankChanges(detectRankChanges(previousRowsRef.current, next));
    previousRowsRef.current = next;
    setRows(next);
    setLoadFailed(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const fetched = await getLeaderboardEntries();

      applyRows(fetched);
    } catch (error) {
      console.error('[leaderboard] failed to load leaderboard', error);
      setLoadFailed(true);
    }
  }, [applyRows]);

  useEffect(() => {
    // Task 5.3 + 5.5: realtime events are signals only - the tracker performs the initial
    // authoritative load and re-fetches on every change (RLS paid-only via anon client),
    // notifying this component through its callback. Rank-change detection runs inside
    // that callback against the previously committed ranking.
    return createLeaderboardTracker({
      subscribe: subscribeToBidChanges,
      fetchLeaderboard: getLeaderboardEntries,
      onLeaderboardChange: applyRows,
      onError: () => setLoadFailed(true),
    });
  }, [applyRows]);

  if (loadFailed && rows === null) {
    return (
      <section className="py-12 sm:py-16 lg:py-20" aria-labelledby="leaderboard-heading">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <LeaderboardError onRetry={() => void refresh()} />
        </div>
      </section>
    );
  }

  if (rows !== null && rows.length === 0) {
    return (
      <section className="py-12 sm:py-16 lg:py-20" aria-labelledby="leaderboard-heading">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <EmptyLeaderboard />
        </div>
      </section>
    );
  }

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

        <div className="rounded-xl border border-border bg-background overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[640px]" role="table" aria-label="Top bidders leaderboard">
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
              {(rows ?? []).map((entry) => (
                <tr
                  key={entry.id}
                  className={`transition-colors duration-150 ease-out hover:bg-muted/50 motion-reduce:transition-none ${
                    entry.rank === 1 ? 'bg-primary/5 border-l-4 border-warning' : ''
                  } ${getRankChangeClass(rankChanges.get(entry.id))}`}
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
                          {(entry.bidderName ?? entry.bidderEmail).charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div className="font-medium text-foreground">
                          {entry.bidderName ?? 'Anonymous bidder'}
                        </div>
                        <div className="text-xs text-muted-foreground">{entry.bidderEmail}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                      {entry.category?.name ?? 'Unknown category'}
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
                    {getTimeAgo(entry.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows === null && (
            <p className="px-4 sm:px-6 py-4 text-sm text-muted-foreground" role="status">
              Loading leaderboard…
            </p>
          )}
        </div>

        <div className="mt-8 text-center">
          <a
            href="/leaderboard"
            className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg border border-border bg-background px-6 py-3.5 text-foreground font-medium text-base transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-11"
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
