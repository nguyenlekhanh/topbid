import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCheckoutSession } from './checkout';

type FakeResult = { data: unknown; error: { message: string } | null };

/**
 * Queue-based fake Supabase boundary, identical in spirit to src/lib/bids.test.ts
 * (deliberately duplicated so the green Task 3.8 suite stays untouched): the CLIENT
 * is not thenable; each thenable query BUILDER consumes the next queued result.
 */
const supabaseMock = vi.hoisted(() => {
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
  createClient: async () => supabaseMock.makeFakeClient(supabaseMock.serverState),
}));

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => supabaseMock.makeFakeClient(supabaseMock.serviceState),
}));

// Task 8.7: createPendingBid now consults the fraud blocklist; checkout tests are not
// about bans, so the lookup is mocked to "not banned" by default.
vi.mock('@/lib/email-bans', () => ({
  isEmailBanned: vi.fn().mockResolvedValue(false),
}));

const stripeMock = vi.hoisted(() => ({
  createSession: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: {
      sessions: {
        create: stripeMock.createSession,
      },
    },
  },
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
    bidder_name: null,
    stripe_session_id: null,
    stripe_payment_intent_id: null,
    status: 'paid',
    is_highest: true,
    created_at: '2026-02-01T00:00:00Z',
    paid_at: '2026-02-01T00:00:00Z',
  };
}

function enqueueServer(...results: FakeResult[]) {
  supabaseMock.serverState.queue.push(...results);
}

function enqueueService(...results: FakeResult[]) {
  supabaseMock.serviceState.queue.push(...results);
}

function lastRpcCall(): { method: string; args: unknown[] } | undefined {
  return (
    [...supabaseMock.serviceState.calls].reverse().find((call) => call.method === 'rpc') ??
    undefined
  );
}

beforeEach(() => {
  supabaseMock.serverState.queue.length = 0;
  supabaseMock.serviceState.queue.length = 0;
  stripeMock.createSession.mockReset();
  stripeMock.createSession.mockResolvedValue({
    id: 'cs_test_abc123',
    url: 'https://checkout.stripe.com/c/pay/cs_test_abc123',
  });
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://topbid.lol');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createCheckoutSession', () => {
  it('creates a payment-mode session priced at the validated bid amount', async () => {
    enqueueServer(
      { data: CATEGORY, error: null },
      { data: CATEGORY, error: null },
      { data: null, error: null },
      { data: CATEGORY, error: null }
    );
    enqueueService({ data: { ...paidBid(1000), status: 'pending' }, error: null });
    enqueueService({ data: true, error: null });

    const result = await createCheckoutSession({
      categorySlug: 'gaming',
      amount: 1000,
      bidderEmail: 'a@b.com',
    });

    expect(result.valid).toBe(true);

    if (result.valid) {
      expect(result.bid.amount).toBe(1000);
      expect(result.checkoutSessionId).toBe('cs_test_abc123');
      expect(result.stripeSessionId).toBe('cs_test_abc123');
      expect(result.url).toBe('https://checkout.stripe.com/c/pay/cs_test_abc123');
    }

    expect(stripeMock.createSession).toHaveBeenCalledTimes(1);
    expect(stripeMock.createSession).toHaveBeenCalledWith({
      mode: 'payment',
      client_reference_id: 'bid-1000',
      metadata: {
        bid_id: 'bid-1000',
        category_id: CATEGORY.id,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: 1000,
            product_data: { name: 'Gaming' },
          },
        },
      ],
      success_url: 'https://topbid.lol/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://topbid.lol/cancel',
    });

    const rpcCall = lastRpcCall();
    expect(rpcCall?.args[0]).toBe('attach_stripe_session');
    expect(rpcCall?.args[1]).toEqual({
      p_bid_id: 'bid-1000',
      p_stripe_session_id: 'cs_test_abc123',
    });
  });

  it('short-circuits without contacting Stripe when input validation fails', async () => {
    const result = await createCheckoutSession({
      categorySlug: 'gaming',
      amount: 10.5,
      bidderEmail: 'a@b.com',
    });

    expect(result).toEqual({
      valid: false,
      reason: 'invalid_amount',
      minimumBid: null,
    });
    expect(stripeMock.createSession).not.toHaveBeenCalled();
    expect(supabaseMock.serverState.queue).toHaveLength(0);
  });

  it('propagates below-minimum failures without contacting Stripe', async () => {
    enqueueServer(
      { data: CATEGORY, error: null },
      { data: CATEGORY, error: null },
      { data: paidBid(1500), error: null }
    );

    const result = await createCheckoutSession({
      categorySlug: 'gaming',
      amount: 1500,
      bidderEmail: 'a@b.com',
    });

    expect(result).toEqual({
      valid: false,
      reason: 'amount_below_minimum',
      minimumBid: 2000,
    });
    expect(stripeMock.createSession).not.toHaveBeenCalled();
  });

  it('wraps Stripe API failures in descriptive errors', async () => {
    enqueueServer(
      { data: CATEGORY, error: null },
      { data: CATEGORY, error: null },
      { data: null, error: null },
      { data: CATEGORY, error: null }
    );
    enqueueService({ data: { ...paidBid(1000), status: 'pending' }, error: null });
    stripeMock.createSession.mockRejectedValue(new Error('stripe unavailable'));

    await expect(
      createCheckoutSession({
        categorySlug: 'gaming',
        amount: 1000,
        bidderEmail: 'a@b.com',
      })
    ).rejects.toThrow('Failed to create Stripe Checkout session: stripe unavailable');
  });

  it('throws when Stripe returns no session URL', async () => {
    enqueueServer(
      { data: CATEGORY, error: null },
      { data: CATEGORY, error: null },
      { data: null, error: null },
      { data: CATEGORY, error: null }
    );
    enqueueService({ data: { ...paidBid(1000), status: 'pending' }, error: null });
    stripeMock.createSession.mockResolvedValue({ id: 'cs_test_abc123', url: null });

    await expect(
      createCheckoutSession({
        categorySlug: 'gaming',
        amount: 1000,
        bidderEmail: 'a@b.com',
      })
    ).rejects.toThrow('Stripe returned no session id/url');
  });

  it('throws when session attachment reports the bid is no longer eligible', async () => {
    enqueueServer(
      { data: CATEGORY, error: null },
      { data: CATEGORY, error: null },
      { data: null, error: null },
      { data: CATEGORY, error: null }
    );
    enqueueService({ data: { ...paidBid(1000), status: 'pending' }, error: null });
    enqueueService({ data: false, error: null });

    await expect(
      createCheckoutSession({
        categorySlug: 'gaming',
        amount: 1000,
        bidderEmail: 'a@b.com',
      })
    ).rejects.toThrow('Failed to link checkout session to bid: bid is no longer eligible');
  });

  it('wraps session-attachment database failures in descriptive errors', async () => {
    enqueueServer(
      { data: CATEGORY, error: null },
      { data: CATEGORY, error: null },
      { data: null, error: null },
      { data: CATEGORY, error: null }
    );
    enqueueService({ data: { ...paidBid(1000), status: 'pending' }, error: null });
    enqueueService({
      data: null,
      error: { message: 'bid_error:duplicate_transaction' },
    });

    await expect(
      createCheckoutSession({
        categorySlug: 'gaming',
        amount: 1000,
        bidderEmail: 'a@b.com',
      })
    ).rejects.toThrow('Failed to link checkout session to bid: bid_error:duplicate_transaction');
  });

  it('throws when the app base URL is not configured', async () => {
    vi.unstubAllEnvs();
    enqueueServer(
      { data: CATEGORY, error: null },
      { data: CATEGORY, error: null },
      { data: null, error: null },
      { data: CATEGORY, error: null }
    );
    enqueueService({ data: { ...paidBid(1000), status: 'pending' }, error: null });

    await expect(
      createCheckoutSession({
        categorySlug: 'gaming',
        amount: 1000,
        bidderEmail: 'a@b.com',
      })
    ).rejects.toThrow('Missing NEXT_PUBLIC_APP_URL');
    expect(stripeMock.createSession).not.toHaveBeenCalled();
  });
});
