import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPendingBid,
  getHighestBidForCategory,
  getIncrementedMinimumBid,
  getInitialMinimumBid,
  getMinimumBidForCategory,
  validateBidAmount,
} from './bids';

type FakeResult = { data: unknown; error: { message: string } | null };

/**
 * Queue-based fake Supabase client boundary. Every awaited query/RPC chain call
 * consumes the next configured result, keeping the real src/lib business logic
 * fully in play while isolating the database. Method calls are recorded for
 * assertions on the create_pending_bid RPC invocation.
 *
 * Two proxies mimic the real shapes: the CLIENT is not thenable (awaiting
 * createClient() yields the client), while each query BUILDER is thenable and
 * resolves with the next queued result.
 */
const mocks = vi.hoisted(() => {
  type FakeResult = { data: unknown; error: { message: string } | null };
  type CallLog = Array<{ method: string; args: unknown[] }>;
  type FakeState = { queue: FakeResult[]; calls: CallLog };

  function makeFakeBuilder(state: FakeState) {
    const builder: unknown = new Proxy(
      {},
      {
        get(_target: unknown, property: string | symbol) {
          if (typeof property !== 'string') {
            return undefined;
          }
          if (property === 'then') {
            return (resolve: (value: FakeResult) => void) => {
              void Promise.resolve().then(() => {
                resolve(state.queue.shift() ?? { data: null, error: null });
              });
            };
          }
          return (...args: unknown[]) => {
            state.calls.push({ method: property, args });
            return builder;
          };
        },
      }
    );
    return builder;
  }

  function makeFakeClient(state: FakeState) {
    const client: unknown = new Proxy(
      {},
      {
        get(_target: unknown, property: string | symbol) {
          if (typeof property !== 'string') {
            return undefined;
          }
          if (property === 'then') {
            return undefined;
          }
          return (...args: unknown[]) => {
            state.calls.push({ method: property, args });
            return makeFakeBuilder(state);
          };
        },
      }
    );
    return client;
  }

  const serverState = { queue: [] as FakeResult[], calls: [] as CallLog };
  const serviceState = { queue: [] as FakeResult[], calls: [] as CallLog };

  return { makeFakeClient, serverState, serviceState };
});

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => mocks.makeFakeClient(mocks.serverState),
}));

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => mocks.makeFakeClient(mocks.serviceState),
}));

const CATEGORY = {
  id: 'cat-1',
  slug: 'gaming',
  name: 'Gaming',
  description: null,
  starting_bid: 1000,
  increment: 500,
  image_url: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function paidBid(amount: number) {
  return {
    id: `bid-${amount}`,
    category_id: CATEGORY.id,
    amount,
    bidder_email: 'winner@example.com',
    bidder_name: 'Winner',
    stripe_session_id: `cs_${amount}`,
    stripe_payment_intent_id: null,
    status: 'paid',
    is_highest: true,
    created_at: '2026-02-01T00:00:00Z',
    paid_at: '2026-02-01T00:00:00Z',
  };
}

function pendingBidRow(amount: number) {
  return { ...paidBid(amount), status: 'pending', is_highest: false, paid_at: null };
}

function enqueueServer(...results: FakeResult[]) {
  mocks.serverState.queue.push(...results);
}

function enqueueService(...results: FakeResult[]) {
  mocks.serviceState.queue.push(...results);
}

function lastRpcCall(): { method: string; args: unknown[] } | undefined {
  return [...mocks.serviceState.calls].reverse().find((call) => call.method === 'rpc') ?? undefined;
}

beforeEach(() => {
  mocks.serverState.queue.length = 0;
  mocks.serverState.calls.length = 0;
  mocks.serviceState.queue.length = 0;
  mocks.serviceState.calls.length = 0;
});

describe('getHighestBidForCategory', () => {
  it('returns the highest paid bid row when one exists', async () => {
    const row = paidBid(1500);
    enqueueServer({ data: row, error: null });

    await expect(getHighestBidForCategory(CATEGORY.id)).resolves.toEqual(row);
  });

  it('returns null for blank slugs without touching the database', async () => {
    await expect(getHighestBidForCategory('   ')).resolves.toBeNull();
    expect(mocks.serverState.calls).toHaveLength(0);
  });
});

describe('getMinimumBidForCategory', () => {
  it('uses the starting bid when no paid bids exist', async () => {
    enqueueServer({ data: CATEGORY, error: null }, { data: null, error: null });

    await expect(getMinimumBidForCategory('gaming')).resolves.toEqual({
      categoryId: CATEGORY.id,
      categorySlug: CATEGORY.slug,
      minimumBid: 1000,
      basis: 'starting_bid',
    });
  });

  it('adds the increment to the highest paid bid', async () => {
    enqueueServer({ data: CATEGORY, error: null }, { data: paidBid(1500), error: null });

    await expect(getMinimumBidForCategory('gaming')).resolves.toEqual({
      categoryId: CATEGORY.id,
      categorySlug: CATEGORY.slug,
      minimumBid: 2000,
      basis: 'highest_bid_plus_increment',
    });
  });

  it('returns null when the category does not exist', async () => {
    enqueueServer({ data: null, error: null });

    await expect(getMinimumBidForCategory('missing')).resolves.toBeNull();
  });
});

describe('getInitialMinimumBid / getIncrementedMinimumBid contracts', () => {
  it('initial minimum equals the starting bid when no paid bids exist', async () => {
    enqueueServer({ data: CATEGORY, error: null }, { data: null, error: null });

    await expect(getInitialMinimumBid('gaming')).resolves.toBe(1000);
  });

  it('initial minimum is null when paid bids already exist', async () => {
    enqueueServer({ data: CATEGORY, error: null }, { data: paidBid(1500), error: null });

    await expect(getInitialMinimumBid('gaming')).resolves.toBeNull();
  });

  it('incremented minimum is null when no paid bids exist', async () => {
    enqueueServer({ data: CATEGORY, error: null }, { data: null, error: null });

    await expect(getIncrementedMinimumBid('gaming')).resolves.toBeNull();
  });

  it('incremented minimum equals highest paid plus increment', async () => {
    enqueueServer({ data: CATEGORY, error: null }, { data: paidBid(1500), error: null });

    await expect(getIncrementedMinimumBid('gaming')).resolves.toBe(2000);
  });
});

describe('validateBidAmount', () => {
  it.each(['abc', 10.5, Number.NaN, Number.POSITIVE_INFINITY, 0, -500, null, {}])(
    'rejects malformed amount %p before querying the database',
    async (amount) => {
      const result = await validateBidAmount('gaming', amount);

      expect(result).toEqual({
        valid: false,
        reason: 'invalid_amount',
        minimumBid: null,
      });
      expect(mocks.serverState.queue).toHaveLength(0);
      expect(mocks.serverState.calls).toHaveLength(0);
    }
  );

  it('accepts an amount exactly equal to the computed minimum', async () => {
    enqueueServer({ data: CATEGORY, error: null }, { data: paidBid(1500), error: null });

    await expect(validateBidAmount('gaming', 2000)).resolves.toEqual({
      valid: true,
      minimumBid: 2000,
      basis: 'highest_bid_plus_increment',
    });
  });

  it('rejects amounts below the authoritative minimum and echoes it', async () => {
    enqueueServer({ data: CATEGORY, error: null }, { data: paidBid(1500), error: null });

    await expect(validateBidAmount('gaming', 1999)).resolves.toEqual({
      valid: false,
      reason: 'amount_below_minimum',
      minimumBid: 2000,
    });
  });

  it('reports category_not_found when the category cannot be resolved', async () => {
    enqueueServer({ data: null, error: null });

    await expect(validateBidAmount('missing', 9999)).resolves.toEqual({
      valid: false,
      reason: 'category_not_found',
      minimumBid: null,
    });
  });
});

describe('createPendingBid local input handling', () => {
  it.each([42, '', 'not-an-email', 'a@b', 'a b@c.com'])(
    'rejects malformed bidder email %p before querying the database',
    async (email) => {
      const result = await createPendingBid({
        categorySlug: 'gaming',
        amount: 1000,
        bidderEmail: email,
      });

      expect(result).toEqual({
        valid: false,
        reason: 'invalid_bidder_email',
        minimumBid: null,
      });
      expect(mocks.serverState.queue).toHaveLength(0);
    }
  );

  it.each([123, 'x'.repeat(101)])('rejects malformed bidder name %p', async (name) => {
    const result = await createPendingBid({
      categorySlug: 'gaming',
      amount: 1000,
      bidderEmail: 'a@b.com',
      bidderName: name,
    });

    expect(result).toEqual({
      valid: false,
      reason: 'invalid_bidder_name',
      minimumBid: null,
    });
  });

  it.each([123, 'x'.repeat(256)])(
    'rejects malformed stripe session identifiers %p',
    async (stripeSessionId) => {
      const result = await createPendingBid({
        categorySlug: 'gaming',
        amount: 1000,
        bidderEmail: 'a@b.com',
        stripeSessionId,
      });

      expect(result).toEqual({
        valid: false,
        reason: 'invalid_stripe_session_id',
        minimumBid: null,
      });
    }
  );

  it.each([1.5, '1000', NaN])('rejects non-integer amounts %p', async (amount) => {
    const result = await createPendingBid({
      categorySlug: 'gaming',
      amount,
      bidderEmail: 'a@b.com',
    });

    expect(result).toEqual({
      valid: false,
      reason: 'invalid_amount',
      minimumBid: null,
    });
  });
});

describe('createPendingBid', () => {
  it('creates a pending bid through the RPC with authoritative values', async () => {
    const inserted = pendingBidRow(1000);
    enqueueServer(
      { data: CATEGORY, error: null },
      { data: CATEGORY, error: null },
      { data: null, error: null }
    );
    enqueueService({ data: inserted, error: null });

    const result = await createPendingBid({
      categorySlug: ' gaming ',
      amount: 1000,
      bidderEmail: ' a@b.com ',
    });

    expect(result).toEqual({ valid: true, bid: inserted });

    const rpcCall = lastRpcCall();
    expect(rpcCall).toBeDefined();
    expect(rpcCall?.args[0]).toBe('create_pending_bid');
    expect(rpcCall?.args[1]).toEqual({
      p_category_id: CATEGORY.id,
      p_amount: 1000,
      p_bidder_email: 'a@b.com',
      p_bidder_name: null,
      p_stripe_session_id: null,
    });
  });

  it('passes trimmed optional bidder name and session identifier', async () => {
    enqueueServer(
      { data: CATEGORY, error: null },
      { data: CATEGORY, error: null },
      { data: paidBid(1500), error: null }
    );
    enqueueService({ data: pendingBidRow(2000), error: null });

    await createPendingBid({
      categorySlug: 'gaming',
      amount: 2000,
      bidderEmail: 'a@b.com',
      bidderName: '  Khanh  ',
      stripeSessionId: '  cs_test_123  ',
    });

    const rpcCall = lastRpcCall();
    expect(rpcCall?.args[1]).toMatchObject({
      p_bidder_name: 'Khanh',
      p_stripe_session_id: 'cs_test_123',
    });
  });

  it('maps duplicate transactions to a stable failure reason', async () => {
    enqueueServer(
      { data: CATEGORY, error: null },
      { data: CATEGORY, error: null },
      { data: null, error: null }
    );
    enqueueService({
      data: null,
      error: { message: 'bid_error:duplicate_transaction' },
    });

    await expect(
      createPendingBid({
        categorySlug: 'gaming',
        amount: 1000,
        bidderEmail: 'a@b.com',
        stripeSessionId: 'cs_dup',
      })
    ).resolves.toEqual({
      valid: false,
      reason: 'duplicate_transaction',
      minimumBid: null,
    });
  });

  it('maps RPC below-minimum failures and echoes the required minimum', async () => {
    enqueueServer(
      { data: CATEGORY, error: null },
      { data: CATEGORY, error: null },
      { data: paidBid(1500), error: null }
    );
    enqueueService({
      data: null,
      error: { message: 'bid_error:amount_below_minimum:2000' },
    });

    await expect(
      createPendingBid({
        categorySlug: 'gaming',
        amount: 1500,
        bidderEmail: 'a@b.com',
      })
    ).resolves.toEqual({
      valid: false,
      reason: 'amount_below_minimum',
      minimumBid: 2000,
    });
  });

  it('maps RPC category failures to category_not_found', async () => {
    enqueueServer({ data: null, error: null });

    await expect(
      createPendingBid({
        categorySlug: 'missing',
        amount: 1000,
        bidderEmail: 'a@b.com',
      })
    ).resolves.toEqual({
      valid: false,
      reason: 'category_not_found',
      minimumBid: null,
    });
  });

  it('throws descriptive errors for unmapped infrastructure failures', async () => {
    enqueueServer(
      { data: CATEGORY, error: null },
      { data: CATEGORY, error: null },
      { data: null, error: null }
    );
    enqueueService({ data: null, error: { message: 'bid_error:unknown_reason' } });

    await expect(
      createPendingBid({
        categorySlug: 'gaming',
        amount: 1000,
        bidderEmail: 'a@b.com',
      })
    ).rejects.toThrow('Failed to create pending bid: bid_error:unknown_reason');
  });
});
