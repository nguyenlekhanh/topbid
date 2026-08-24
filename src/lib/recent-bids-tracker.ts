import type { BidChangePayload } from './realtime';

/**
 * Live recent-bids tracking (Task 5.4).
 *
 * Any bids change can affect the newest-first feed, so all realtime events are signals
 * for an authoritative re-fetch via the injected fetcher. Bursts coalesce into at most
 * one trailing refetch, and subscribers are notified only when the fetched feed actually
 * differs (JSON comparison) - payload values themselves never drive the UI.
 */
export type RecentBidsTrackerOptions<T> = {
  subscribe: (onChange: (payload: BidChangePayload) => void) => () => void;
  fetchRecentBids: () => Promise<T[]>;
  onRecentBidsChange: (entries: T[]) => void;
  onError?: (error: unknown) => void;
};

export function createRecentBidsTracker<T>(options: RecentBidsTrackerOptions<T>): () => void {
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
      const entries = await options.fetchRecentBids();
      const snapshot = JSON.stringify(entries);

      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot;
        options.onRecentBidsChange(entries);
      }
    } catch (error) {
      console.error('[recent-bids] failed to refresh recent bids', error);
      options.onError?.(error);
    } finally {
      fetching = false;

      if (pendingRefetch) {
        pendingRefetch = false;
        void refetch();
      }
    }
  };

  // Initial authoritative load: consumers render purely from callbacks.
  void refetch();

  return options.subscribe(() => {
    void refetch();
  });
}
