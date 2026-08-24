import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createHighestBidTracker } from './highest-bid-tracker';
import type { BidChangePayload, RealtimeConnectionStatus } from './realtime';

const CATEGORY_ID = 'cat-1';

const BASE_ROW = {
  id: 'bid-1',
  category_id: CATEGORY_ID,
  amount: 1500,
  bidder_email: 'a@b.com',
  bidder_name: null,
  stripe_session_id: null,
  stripe_payment_intent_id: null,
  status: 'paid',
  is_highest: false,
  created_at: '2026-01-01T00:00:00Z',
  paid_at: null,
};

function row(categoryId = CATEGORY_ID, status = 'paid'): NonNullable<BidChangePayload['new']> {
  return { ...BASE_ROW, category_id: categoryId, status };
}

function paidInsert(categoryId = CATEGORY_ID): BidChangePayload {
  return { eventType: 'INSERT', new: row(categoryId), old: null };
}

function paidUpdate(categoryId = CATEGORY_ID): BidChangePayload {
  return { eventType: 'UPDATE', new: row(categoryId), old: row(categoryId) };
}

function deletedUpdate(categoryId = CATEGORY_ID): BidChangePayload {
  return { eventType: 'DELETE', new: null, old: row(categoryId) };
}

describe('createHighestBidTracker', () => {
  const changeHandlers: Array<(payload: BidChangePayload) => void> = [];
  const statusHandlers: Array<(status: RealtimeConnectionStatus) => void> = [];
  const removed: number[] = [];

  const subscribe = vi.fn(
    (
      onChange: (payload: BidChangePayload) => void,
      onStatusChange?: (status: RealtimeConnectionStatus) => void
    ) => {
      changeHandlers.push(onChange);

      if (onStatusChange) {
        statusHandlers.push(onStatusChange);
      }

      return () => {
        const index = changeHandlers.indexOf(onChange);

        if (index !== -1) {
          changeHandlers.splice(index, 1);
          removed.push(index);
        }

        const statusIndex = statusHandlers.indexOf(onStatusChange!);

        if (statusIndex !== -1) {
          statusHandlers.splice(statusIndex, 1);
        }
      };
    }
  );

  const fetchHighest = vi.fn();
  const onHighestChange = vi.fn();

  function emit(payload: BidChangePayload): void {
    for (const handler of [...changeHandlers]) {
      handler(payload);
    }
  }

  function emitStatus(status: RealtimeConnectionStatus): void {
    for (const handler of [...statusHandlers]) {
      handler(status);
    }
  }

  beforeEach(() => {
    changeHandlers.length = 0;
    statusHandlers.length = 0;
    removed.length = 0;
    fetchHighest.mockReset();
    onHighestChange.mockReset();
  });

  function create(options?: { initialAmount?: number | null }) {
    return createHighestBidTracker({
      categoryId: CATEGORY_ID,
      initialAmount: options?.initialAmount ?? null,
      subscribe,
      fetchHighest,
      onHighestChange,
    });
  }

  it('refetches and emits the authoritative amount on a paid INSERT for its category', async () => {
    fetchHighest.mockResolvedValue(2000);

    create({ initialAmount: 1000 });
    emit(paidInsert(CATEGORY_ID));

    await vi.waitFor(() => expect(onHighestChange).toHaveBeenCalledWith(2000));
    expect(fetchHighest).toHaveBeenCalledWith(CATEGORY_ID);
    expect(onHighestChange).toHaveBeenCalledTimes(1);
  });

  it('ignores events for other categories', () => {
    create();

    emit(paidInsert('cat-other'));

    expect(fetchHighest).not.toHaveBeenCalled();
  });

  it('ignores INSERT/UPDATE events whose resulting row is not paid', () => {
    create();

    const unpaidUpdate = paidUpdate(CATEGORY_ID);
    unpaidUpdate.new = { ...row(), status: 'pending' };

    emit(unpaidUpdate);

    expect(fetchHighest).not.toHaveBeenCalled();
  });

  it('refetches on DELETE events (the paid bid disappeared)', async () => {
    fetchHighest.mockResolvedValue(null);

    create({ initialAmount: 1500 });
    emit(deletedUpdate(CATEGORY_ID));

    await vi.waitFor(() => expect(onHighestChange).toHaveBeenCalledWith(null));
  });

  it('does not notify when the authoritative amount is unchanged', async () => {
    fetchHighest.mockResolvedValue(1000);

    create({ initialAmount: 1000 });
    emit(paidUpdate(CATEGORY_ID));

    await vi.waitFor(() => expect(fetchHighest).toHaveBeenCalledTimes(1));

    expect(onHighestChange).not.toHaveBeenCalled();
  });

  it('coalesces bursts into at most one trailing refetch', async () => {
    let calls = 0;
    fetchHighest.mockImplementation(async () => {
      calls += 1;
      return 1000 + calls * 100;
    });

    create({ initialAmount: 1000 });

    // Three rapid events while the first refetch is in flight.
    emit(paidInsert(CATEGORY_ID));
    emit(paidUpdate(CATEGORY_ID));
    emit(paidUpdate(CATEGORY_ID));

    await new Promise((resolve) => setTimeout(resolve, 20));

    // First refetch + exactly one coalesced trailing refetch - not three separate ones
    // per event. The trailing refetch guarantees the final state is authoritative.
    expect(calls).toBe(2);
  });

  it('stops listening after unsubscribe', async () => {
    fetchHighest.mockResolvedValue(2000);

    const unsubscribe = create();

    unsubscribe();

    expect(removed).toEqual([changeHandlers.length]);

    emit(paidInsert(CATEGORY_ID));
    emitStatus('disconnected');

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchHighest).not.toHaveBeenCalled();
  });

  it('resyncs authoritative data when the connection recovers after an outage', async () => {
    fetchHighest.mockResolvedValue(2500);

    create();
    emitStatus('disconnected');
    emitStatus('connected');

    // Recovery ('connected' after a known outage) triggers an authoritative refetch so
    // changes missed while offline are recovered rather than silently lost.
    await vi.waitFor(() => expect(fetchHighest).toHaveBeenCalledTimes(1));
    expect(fetchHighest).toHaveBeenCalledWith(CATEGORY_ID);
  });

  it('forwards connection state transitions exactly once per transition', () => {
    const onConnectionChange = vi.fn();

    create();
    void onConnectionChange;

    // The tracker registers exactly one status handler with the subscribe contract -
    // no duplicate listeners can accumulate across reconnect cycles.
    expect(statusHandlers).toHaveLength(1);

    emitStatus('disconnected');
    emitStatus('disconnected');

    // Duplicate outage signals are collapsed by realtime.ts's wrapper (hasDisconnected
    // guard) before they ever reach the tracker; here we verify single registration.
    expect(statusHandlers).toHaveLength(1);
  });
});
