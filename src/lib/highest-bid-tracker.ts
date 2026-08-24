import type { BidChangePayload } from './realtime';

/**
 * Live highest-bid tracking for a single category (Task 5.2).
 *
 * Realtime events are used only as a SIGNAL that something changed for the category;
 * the displayed value is always re-fetched from the authoritative paid-bids query.
 * Events for other categories are ignored, bursts are coalesced, and the callback fires
 * only when the authoritative amount actually changes.
 */
export type HighestBidTrackerOptions = {
  categoryId: string;
  initialAmount?: number | null;
  subscribe: (onChange: (payload: BidChangePayload) => void) => () => void;
  fetchHighest: (categoryId: string) => Promise<number | null>;
  onHighestChange: (amount: number | null) => void;
};

function isRelevantEvent(payload: BidChangePayload, categoryId: string): boolean {
  const touchedCategory =
    payload.new?.category_id === categoryId || payload.old?.category_id === categoryId;

  if (!touchedCategory) {
    return false;
  }

  // DELETE rows no longer exist; INSERT/UPDATE only matter when the resulting row is
  // a paid bid (defense in depth - RLS already filters non-paid rows for anon clients).
  if (payload.eventType !== 'DELETE' && payload.new && payload.new.status !== 'paid') {
    return false;
  }

  return true;
}

export function createHighestBidTracker(options: HighestBidTrackerOptions): () => void {
  let latest = options.initialAmount ?? null;
  let fetching = false;
  let pendingRefetch = false;

  const refetch = async (): Promise<void> => {
    if (fetching) {
      pendingRefetch = true;
      return;
    }

    fetching = true;

    try {
      const amount = await options.fetchHighest(options.categoryId);

      if (amount !== latest) {
        latest = amount;
        options.onHighestChange(amount);
      }
    } catch (error) {
      console.error('[highest-bid] failed to refresh highest bid', error);
    } finally {
      fetching = false;

      if (pendingRefetch) {
        pendingRefetch = false;
        void refetch();
      }
    }
  };

  return options.subscribe((payload) => {
    if (!isRelevantEvent(payload, options.categoryId)) {
      return;
    }

    void refetch();
  });
}
