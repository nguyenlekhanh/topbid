import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLeaderboardTracker } from './leaderboard-tracker';
import type { BidChangePayload } from './realtime';

type LeaderboardRow = { id: string; amount: number };

function makeEntries(id: string, amount: number): LeaderboardRow[] {
  return [{ id, amount }];
}

function anyEvent(): BidChangePayload {
  return { eventType: 'INSERT', new: null, old: null };
}

describe('createLeaderboardTracker', () => {
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

  const fetchLeaderboard = vi.fn<() => Promise<LeaderboardRow[]>>();
  const onLeaderboardChange = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    changeHandlers.length = 0;
    unsubscribed = false;
    subscribe.mockClear();
    fetchLeaderboard.mockReset();
    onLeaderboardChange.mockReset();
    onError.mockReset();
  });

  it('performs an initial authoritative fetch on creation', async () => {
    const data = makeEntries('bid-0', 500);
    fetchLeaderboard.mockResolvedValue(data);

    createLeaderboardTracker({ subscribe, fetchLeaderboard, onLeaderboardChange });

    await vi.waitFor(() =>
      expect(onLeaderboardChange).toHaveBeenCalledWith([{ id: 'bid-0', amount: 500 }])
    );
  });

  it('refetches and emits authoritative entries when a bid event arrives', async () => {
    const data = makeEntries('bid-1', 1500);
    fetchLeaderboard.mockResolvedValueOnce(makeEntries('bid-0', 500)).mockResolvedValueOnce(data);

    createLeaderboardTracker({ subscribe, fetchLeaderboard, onLeaderboardChange });
    await vi.waitFor(() => expect(onLeaderboardChange).toHaveBeenCalledTimes(1));

    changeHandlers[0](anyEvent());

    await vi.waitFor(() =>
      expect(onLeaderboardChange).toHaveBeenCalledWith([{ id: 'bid-1', amount: 1500 }])
    );
    expect(fetchLeaderboard).toHaveBeenCalledTimes(2);
  });

  it('does not notify again when refetched entries are identical to the previous snapshot', async () => {
    const data = makeEntries('bid-1', 1500);
    fetchLeaderboard.mockResolvedValue(data);

    createLeaderboardTracker({ subscribe, fetchLeaderboard, onLeaderboardChange });
    await vi.waitFor(() => expect(onLeaderboardChange).toHaveBeenCalledTimes(1));

    changeHandlers[0](anyEvent());

    await vi.waitFor(() => expect(fetchLeaderboard).toHaveBeenCalledTimes(2));

    expect(onLeaderboardChange).toHaveBeenCalledTimes(1);
  });

  it('notifies when refetched entries differ from the previous snapshot', async () => {
    fetchLeaderboard
      .mockResolvedValueOnce(makeEntries('bid-1', 1500))
      .mockResolvedValueOnce(makeEntries('bid-2', 9000));

    createLeaderboardTracker({ subscribe, fetchLeaderboard, onLeaderboardChange });
    await vi.waitFor(() => expect(onLeaderboardChange).toHaveBeenCalledTimes(1));

    changeHandlers[0](anyEvent());

    await vi.waitFor(() => expect(onLeaderboardChange).toHaveBeenCalledTimes(2));
    expect(onLeaderboardChange).toHaveBeenLastCalledWith([{ id: 'bid-2', amount: 9000 }]);
  });

  it('coalesces bursts into at most one trailing refetch', async () => {
    fetchLeaderboard
      .mockResolvedValueOnce(makeEntries('bid-1', 1500))
      .mockResolvedValueOnce(makeEntries('bid-2', 9000));

    createLeaderboardTracker({ subscribe, fetchLeaderboard, onLeaderboardChange });

    // Initial load is in flight; these rapid events collapse into one trailing refetch.
    changeHandlers[0](anyEvent());
    changeHandlers[0](anyEvent());
    changeHandlers[0](anyEvent());

    await vi.waitFor(() => expect(fetchLeaderboard).toHaveBeenCalledTimes(2));
    expect(onLeaderboardChange).toHaveBeenLastCalledWith([makeEntries('bid-2', 9000)[0]]);
  });

  it('logs but does not throw on fetch failures, staying ready for the next event', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchLeaderboard
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(makeEntries('bid-1', 1500));

    createLeaderboardTracker({
      subscribe,
      fetchLeaderboard,
      onLeaderboardChange,
      onError,
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));

    changeHandlers[0](anyEvent());
    await vi.waitFor(() =>
      expect(onLeaderboardChange).toHaveBeenCalledWith([{ id: 'bid-1', amount: 1500 }])
    );

    errorSpy.mockRestore();
  });

  it('unsubscribes so later events no longer trigger refetches', async () => {
    fetchLeaderboard.mockResolvedValue(makeEntries('bid-1', 1500));

    const unsubscribe = createLeaderboardTracker({
      subscribe,
      fetchLeaderboard,
      onLeaderboardChange,
    });

    await vi.waitFor(() => expect(onLeaderboardChange).toHaveBeenCalled());

    unsubscribe();

    // Delivery path severed: no registered handlers remain for the channel.
    expect(unsubscribed).toBe(true);
    expect(changeHandlers).toHaveLength(0);

    const callsBefore = fetchLeaderboard.mock.calls.length;

    // Even if a late delivery raced through a stale reference, the tracker is gone.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchLeaderboard.mock.calls.length).toBe(callsBefore);
  });
});
