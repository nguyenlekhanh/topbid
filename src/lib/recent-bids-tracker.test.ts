import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRecentBidsTracker } from './recent-bids-tracker';
import type { BidChangePayload } from './realtime';

type RecentBidRow = { id: string; amount: number };

function makeEntries(id: string, amount: number): RecentBidRow[] {
  return [{ id, amount }];
}

function anyEvent(): BidChangePayload {
  return { eventType: 'INSERT', new: null, old: null };
}

describe('createRecentBidsTracker', () => {
  const changeHandlers: Array<(payload: BidChangePayload) => void> = [];
  let unsubscribed = false;

  const subscribe = vi.fn((onChange: (payload: BidChangePayload) => void) => {
    changeHandlers.push(onChange);

    return () => {
      const index = changeHandlers.indexOf(onChange);

      if (index !== -1) {
        changeHandlers.splice(index, 1);
      }

      unsubscribed = true;
    };
  });

  const fetchRecentBids = vi.fn<() => Promise<RecentBidRow[]>>();
  const onRecentBidsChange = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    changeHandlers.length = 0;
    unsubscribed = false;
    subscribe.mockClear();
    fetchRecentBids.mockReset();
    onRecentBidsChange.mockReset();
    onError.mockReset();
  });

  it('performs an initial authoritative fetch on creation', async () => {
    const data = makeEntries('bid-0', 47500);
    fetchRecentBids.mockResolvedValue(data);

    createRecentBidsTracker({ subscribe, fetchRecentBids, onRecentBidsChange });

    await vi.waitFor(() =>
      expect(onRecentBidsChange).toHaveBeenCalledWith([{ id: 'bid-0', amount: 47500 }])
    );
  });

  it('refetches and emits authoritative entries when a bid event arrives', async () => {
    fetchRecentBids
      .mockResolvedValueOnce(makeEntries('bid-0', 47500))
      .mockResolvedValueOnce(makeEntries('bid-1', 53000));

    createRecentBidsTracker({ subscribe, fetchRecentBids, onRecentBidsChange });
    await vi.waitFor(() => expect(onRecentBidsChange).toHaveBeenCalledTimes(1));

    changeHandlers[0](anyEvent());

    await vi.waitFor(() =>
      expect(onRecentBidsChange).toHaveBeenCalledWith([{ id: 'bid-1', amount: 53000 }])
    );
    expect(fetchRecentBids).toHaveBeenCalledTimes(2);
  });

  it('does not notify again when refetched entries are identical to the previous snapshot', async () => {
    const data = makeEntries('bid-0', 47500);
    fetchRecentBids.mockResolvedValue(data);

    createRecentBidsTracker({ subscribe, fetchRecentBids, onRecentBidsChange });
    await vi.waitFor(() => expect(onRecentBidsChange).toHaveBeenCalledTimes(1));

    changeHandlers[0](anyEvent());

    await vi.waitFor(() => expect(fetchRecentBids).toHaveBeenCalledTimes(2));

    expect(onRecentBidsChange).toHaveBeenCalledTimes(1);
  });

  it('notifies when refetched entries differ from the previous snapshot', async () => {
    fetchRecentBids
      .mockResolvedValueOnce(makeEntries('bid-0', 47500))
      .mockResolvedValueOnce(makeEntries('bid-1', 53000));

    createRecentBidsTracker({ subscribe, fetchRecentBids, onRecentBidsChange });
    await vi.waitFor(() => expect(onRecentBidsChange).toHaveBeenCalledTimes(1));

    changeHandlers[0](anyEvent());

    await vi.waitFor(() => expect(onRecentBidsChange).toHaveBeenCalledTimes(2));
    expect(onRecentBidsChange).toHaveBeenLastCalledWith([{ id: 'bid-1', amount: 53000 }]);
  });

  it('coalesces bursts into at most one trailing refetch', async () => {
    fetchRecentBids
      .mockResolvedValueOnce(makeEntries('bid-0', 47500))
      .mockResolvedValueOnce(makeEntries('bid-1', 53000));

    createRecentBidsTracker({ subscribe, fetchRecentBids, onRecentBidsChange });

    // Rapid events while the initial load is in flight collapse into one trailing call.
    changeHandlers[0](anyEvent());
    changeHandlers[0](anyEvent());
    changeHandlers[0](anyEvent());

    await vi.waitFor(() => expect(fetchRecentBids).toHaveBeenCalledTimes(2));
    expect(onRecentBidsChange).toHaveBeenLastCalledWith([{ id: 'bid-1', amount: 53000 }]);
  });

  it('reports errors via onError but stays ready for the next event', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchRecentBids
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(makeEntries('bid-0', 47500));

    createRecentBidsTracker({
      subscribe,
      fetchRecentBids,
      onRecentBidsChange,
      onError,
    });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));
    errorSpy.mockRestore();

    changeHandlers[0](anyEvent());
    await vi.waitFor(() =>
      expect(onRecentBidsChange).toHaveBeenCalledWith([{ id: 'bid-0', amount: 47500 }])
    );
  });

  it('unsubscribes so later events no longer trigger refetches', async () => {
    fetchRecentBids.mockResolvedValue(makeEntries('bid-0', 47500));

    const unsubscribe = createRecentBidsTracker({
      subscribe,
      fetchRecentBids,
      onRecentBidsChange,
    });

    await vi.waitFor(() => expect(onRecentBidsChange).toHaveBeenCalled());

    unsubscribe();

    // Delivery path severed: no registered handlers remain for the channel.
    expect(unsubscribed).toBe(true);
    expect(changeHandlers).toHaveLength(0);

    const callsBefore = fetchRecentBids.mock.calls.length;

    // Even if a late delivery raced through a stale reference, the tracker is gone.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchRecentBids.mock.calls.length).toBe(callsBefore);
  });
});
