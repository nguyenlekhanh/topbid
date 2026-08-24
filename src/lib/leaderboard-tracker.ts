import type { BidChangePayload } from './realtime';

/**
 * Live leaderboard tracking (Task 5.3).
 *
 * Every bids change can affect the global ranking, so all realtime events are signals
 * for an authoritative re-fetch via the injected fetcher. Bursts coalesce into at most
 * one trailing refetch, and subscribers are notified only when the fetched entries
 * actually differ (JSON comparison) - the payload values themselves never drive the UI.
 */
export type LeaderboardTrackerOptions<T> = {
  subscribe: (onChange: (payload: BidChangePayload) => void) => () => void;
  fetchLeaderboard: () => Promise<T[]>;
  onLeaderboardChange: (entries: T[]) => void;
  onError?: (error: unknown) => void;
};

export function createLeaderboardTracker<T>(options: LeaderboardTrackerOptions<T>): () => void {
  let fetching = false;
  let pendingRefetch = false;
  let lastSnapshot = '';

  const refetch = async (): Promise<void> => {
    if (fetching) {
      pendingRefetch = true;
      return;
    }

    fetching = true;

    try {
      const entries = await options.fetchLeaderboard();
      const snapshot = JSON.stringify(entries);

      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot;
        options.onLeaderboardChange(entries);
      }
    } catch (error) {
      console.error('[leaderboard] failed to refresh leaderboard', error);
      options.onError?.(error);
    } finally {
      fetching = false;

      if (pendingRefetch) {
        pendingRefetch = false;
        void refetch();
      }
    }
  };

  // Initial authoritative load happens here too: consumers render purely from
  // onLeaderboardChange callbacks and never need a separate manual first fetch.
  void refetch();

  return options.subscribe(() => {
    void refetch();
  });
}
