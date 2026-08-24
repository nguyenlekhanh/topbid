import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createHighestBidTracker } from './highest-bid-tracker';
import type { BidChangePayload } from './realtime';

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
  const removed: number[] = [];

  const subscribe = vi.fn((onChange: (payload: BidChangePayload) => void) => {
    changeHandlers.push(onChange);

    return () => {
      const index = changeHandlers.indexOf(onChange);

      if (index !== -1) {
        changeHandlers.splice(index, 1);
        removed.push(index);
      }
    };
  });

  const fetchHighest = vi.fn();
  const onHighestChange = vi.fn();

  function emit(payload: BidChangePayload): void {
    for (const handler of [...changeHandlers]) {
      handler(payload);
    }
  }

  beforeEach(() => {
    changeHandlers.length = 0;
    removed.length = 0;
    fetchHighest.mockReset();
    onHighestChange.mockReset();
  });

  function create(overrides?: { initialAmount?: number | null }) {
    return createHighestBidTracker({
      categoryId: CATEGORY_ID,
      initialAmount: overrides?.initialAmount ?? null,
      subscribe,
      fetchHighest,
      onHighestChange,
    });
  }

  it('refetches and emits the authoritative amount on a paid INSERT for its category', async () => {
    fetchHighest.mockResolvedValue(2000);

    create({ initialAmount: 1000 });
    emit(paidInsert());

    await vi.waitFor(() => expect(onHighestChange).toHaveBeenCalledWith(2000));
    expect(fetchHighest).toHaveBeenCalledWith(CATEGORY_ID);
    expect(onHighestChange).toHaveBeenCalledTimes(1);
  });

  it('ignores events for other categories entirely', async () => {
    create();

    emit(paidInsert('cat-other'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchHighest).not.toHaveBeenCalled();
    expect(onHighestChange).not.toHaveBeenCalled();
  });

  it('ignores INSERT/UPDATE events whose resulting row is not paid', async () => {
    create();

    emit({
      eventType: 'INSERT',
      new: row(CATEGORY_ID, 'pending'),
      old: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchHighest).not.toHaveBeenCalled();
    expect(onHighestChange).not.toHaveBeenCalled();
  });

  it('refetches on DELETE events (the paid bid disappeared)', async () => {
    fetchHighest.mockResolvedValue(null);

    create({ initialAmount: 1500 });
    emit(deletedUpdate());

    await vi.waitFor(() => expect(onHighestChange).toHaveBeenCalledWith(null));
  });

  it('does not notify when the authoritative amount is unchanged', async () => {
    fetchHighest.mockResolvedValue(1000);

    create({ initialAmount: 1000 });
    emit(paidUpdate());

    await vi.waitFor(() => expect(fetchHighest).toHaveBeenCalledTimes(1));

    expect(onHighestChange).not.toHaveBeenCalled();
  });

  it('coalesces bursts into at most one trailing refetch', async () => {
    fetchHighest.mockResolvedValueOnce(1200).mockResolvedValueOnce(1300);

    create({ initialAmount: 1000 });

    // Three rapid events while the first refetch is in flight.
    emit(paidUpdate());
    emit(paidUpdate());
    emit(paidUpdate());

    await vi.waitFor(() => expect(fetchHighest).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(onHighestChange).toHaveBeenLastCalledWith(1300));

    // First call + exactly one coalesced trailing refetch - not three.
    expect(fetchHighest).toHaveBeenCalledTimes(2);
  });

  it('stops listening after unsubscribe', async () => {
    fetchHighest.mockResolvedValue(2000);

    const unsubscribe = create();
    unsubscribe();

    expect(removed).toEqual([0]);

    emit(paidInsert());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchHighest).not.toHaveBeenCalled();
    expect(onHighestChange).not.toHaveBeenCalled();
  });
});
