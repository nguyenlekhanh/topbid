import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processStripeWebhook, verifyCheckoutSessionPaid } from './stripe-webhook';

const stripeMock = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  retrieveSession: vi.fn(),
}));

const supabaseMock = vi.hoisted(() => {
  type FakeResult = { data: unknown; error: { message: string } | null };

  const state = {
    queue: [] as FakeResult[],
    calls: [] as Array<{ method: string; args: unknown[] }>,
  };

  function makeFakeBuilder() {
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

  function makeFakeClient() {
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
            return makeFakeBuilder();
          };
        },
      }
    );
    return client;
  }

  return { state, makeFakeClient };
});

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => supabaseMock.makeFakeClient(),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: {
      constructEvent: stripeMock.constructEvent,
    },
    checkout: {
      sessions: {
        retrieve: stripeMock.retrieveSession,
      },
    },
  },
}));

const COMPLETED_EVENT = {
  id: 'evt_123',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_abc',
      client_reference_id: 'bid-1000',
      metadata: { bid_id: 'bid-1000' },
    },
  },
};

const VALID_SIGNATURE = 't=1760000000,v1=signature';

beforeEach(() => {
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
  stripeMock.constructEvent.mockReset();
  stripeMock.constructEvent.mockReturnValue(COMPLETED_EVENT);
  stripeMock.retrieveSession.mockReset();
  stripeMock.retrieveSession.mockResolvedValue({
    id: 'cs_test_abc',
    payment_status: 'paid',
    client_reference_id: 'bid-1000',
    metadata: { bid_id: 'bid-1000' },
    payment_intent: 'pi_test_123',
  });
  supabaseMock.state.queue.length = 0;
  supabaseMock.state.calls.length = 0;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function enqueueConversionOutcome(outcome: string) {
  supabaseMock.state.queue.push({ data: outcome, error: null });
}

function lastRpcCall(): { method: string; args: unknown[] } | undefined {
  return [...supabaseMock.state.calls].reverse().find((call) => call.method === 'rpc') ?? undefined;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('processStripeWebhook', () => {
  it('returns 200 received for a verified plan-required event', async () => {
    enqueueConversionOutcome('converted');

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true' });
    expect(stripeMock.constructEvent).toHaveBeenCalledWith(
      'raw-payload',
      VALID_SIGNATURE,
      'whsec_test',
      300
    );
  });

  it('passes the raw payload to verification without parsing it first', async () => {
    enqueueConversionOutcome('converted');

    await processStripeWebhook('{"weird":"but raw"}', VALID_SIGNATURE);

    expect(stripeMock.constructEvent).toHaveBeenCalledWith(
      '{"weird":"but raw"}',
      VALID_SIGNATURE,
      'whsec_test',
      300
    );
  });

  it('acknowledges and ignores unsupported event types with 200', async () => {
    stripeMock.constructEvent.mockReturnValue({
      ...COMPLETED_EVENT,
      id: 'evt_456',
      type: 'invoice.paid',
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true', ignored: 'true' });
  });

  it('returns 400 when signature verification fails', async () => {
    stripeMock.constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Invalid signature' });
  });

  it.each([undefined, null, ''])(
    'returns 400 when the signature header is %p',
    async (signature) => {
      const result = await processStripeWebhook('raw-payload', signature ?? null);

      expect(result.status).toBe(400);
      expect(stripeMock.constructEvent).not.toHaveBeenCalled();
    }
  );

  it('returns 400 when the payload is empty or not raw text', async () => {
    const result = await processStripeWebhook('', VALID_SIGNATURE);

    expect(result.status).toBe(400);
    expect(stripeMock.constructEvent).not.toHaveBeenCalled();
  });

  it('returns 500 when the webhook secret is not configured', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(500);
    expect(stripeMock.constructEvent).not.toHaveBeenCalled();
  });

  it('returns 200 for duplicate/replayed verified events with no side effects', async () => {
    enqueueConversionOutcome('converted');
    enqueueConversionOutcome('already_paid');

    const first = await processStripeWebhook('raw-payload', VALID_SIGNATURE);
    const second = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(stripeMock.constructEvent).toHaveBeenCalledTimes(2);
  });

  it('returns 500 on unexpected processing failures so Stripe retries', async () => {
    const throwingEvent = {
      id: 'evt_789',
      type: 'checkout.session.completed',
      get data(): never {
        throw new Error('malformed event envelope');
      },
    };
    stripeMock.constructEvent.mockReturnValue(throwingEvent as never);

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Webhook processing failed' });
  });
});

describe('verifyCheckoutSessionPaid (Task 4.7)', () => {
  it('verifies when the authoritative session state is paid with consistent linkage', async () => {
    await expect(verifyCheckoutSessionPaid('cs_test_abc')).resolves.toEqual({
      verified: true,
      sessionId: 'cs_test_abc',
      bidReference: 'bid-1000',
      paymentIntentId: 'pi_test_123',
    });
    expect(stripeMock.retrieveSession).toHaveBeenCalledWith('cs_test_abc');
  });

  it('verifies from metadata alone when client_reference_id is absent', async () => {
    stripeMock.retrieveSession.mockResolvedValue({
      id: 'cs_test_abc',
      payment_status: 'paid',
      client_reference_id: null,
      metadata: { bid_id: 'bid-1000' },
    });

    await expect(verifyCheckoutSessionPaid('cs_test_abc')).resolves.toEqual({
      verified: true,
      sessionId: 'cs_test_abc',
      bidReference: 'bid-1000',
      paymentIntentId: null,
    });
  });

  it.each(['unpaid', 'no_payment_required'])(
    'rejects authoritative payment_status %p as not paid',
    async (paymentStatus) => {
      stripeMock.retrieveSession.mockResolvedValue({
        id: 'cs_test_abc',
        payment_status: paymentStatus,
        client_reference_id: 'bid-1000',
        metadata: { bid_id: 'bid-1000' },
      });

      await expect(verifyCheckoutSessionPaid('cs_test_abc')).resolves.toEqual({
        verified: false,
        reason: 'session_not_paid',
        sessionId: 'cs_test_abc',
      });
    }
  );

  it('rejects sessions without any bid reference', async () => {
    stripeMock.retrieveSession.mockResolvedValue({
      id: 'cs_test_abc',
      payment_status: 'paid',
      client_reference_id: null,
      metadata: {},
    });

    await expect(verifyCheckoutSessionPaid('cs_test_abc')).resolves.toEqual({
      verified: false,
      reason: 'missing_bid_reference',
      sessionId: 'cs_test_abc',
    });
  });

  it('rejects sessions with mismatched bid references', async () => {
    stripeMock.retrieveSession.mockResolvedValue({
      id: 'cs_test_abc',
      payment_status: 'paid',
      client_reference_id: 'bid-1000',
      metadata: { bid_id: 'bid-other' },
    });

    await expect(verifyCheckoutSessionPaid('cs_test_abc')).resolves.toEqual({
      verified: false,
      reason: 'reference_mismatch',
      sessionId: 'cs_test_abc',
    });
  });

  it('re-throws retrieval failures so the endpoint responds 500', async () => {
    stripeMock.retrieveSession.mockRejectedValue(new Error('stripe unavailable'));

    await expect(verifyCheckoutSessionPaid('cs_test_abc')).rejects.toThrow(
      'Failed to retrieve Checkout Session "cs_test_abc": stripe unavailable'
    );
  });
});

describe('checkout.session.completed verification flow (Task 4.7)', () => {
  it('acknowledges verified events with 200 after successful status verification', async () => {
    enqueueConversionOutcome('converted');

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(stripeMock.retrieveSession).toHaveBeenCalledWith('cs_test_abc');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('acknowledges unverified unpaid sessions with 200 and no mutation path', async () => {
    stripeMock.retrieveSession.mockResolvedValue({
      id: 'cs_test_abc',
      payment_status: 'unpaid',
      client_reference_id: 'bid-1000',
      metadata: { bid_id: 'bid-1000' },
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true' });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('NOT verified (session_not_paid)'),
      expect.any(String)
    );
    expect(supabaseMock.state.calls).toHaveLength(0);
  });

  it('returns 500 when the authoritative session cannot be retrieved', async () => {
    stripeMock.retrieveSession.mockRejectedValue(new Error('stripe unavailable'));

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Webhook processing failed' });
    expect(supabaseMock.state.calls).toHaveLength(0);
  });

  it('does not consult Stripe for unsupported event types', async () => {
    stripeMock.constructEvent.mockReturnValue({
      ...COMPLETED_EVENT,
      type: 'invoice.paid',
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(stripeMock.retrieveSession).not.toHaveBeenCalled();
    expect(supabaseMock.state.calls).toHaveLength(0);
  });
});

describe('bid conversion (Task 4.8)', () => {
  it('converts the linked pending bid via the RPC with authoritative values', async () => {
    enqueueConversionOutcome('converted');

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(lastRpcCall()?.args[0]).toBe('convert_pending_bid_to_paid');
    expect(lastRpcCall()?.args[1]).toEqual({
      p_bid_id: 'bid-1000',
      p_stripe_session_id: 'cs_test_abc',
      p_stripe_payment_intent_id: 'pi_test_123',
    });
  });

  it('treats repeated confirmations of the same session as success without re-converting', async () => {
    enqueueConversionOutcome('already_paid');

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(lastRpcCall()?.args[1]).toEqual({
      p_bid_id: 'bid-1000',
      p_stripe_session_id: 'cs_test_abc',
      p_stripe_payment_intent_id: 'pi_test_123',
    });
  });

  it.each(['bid_not_found', 'invalid_state', 'session_mismatch'])(
    'returns 500 when conversion reports %p so Stripe retries',
    async (outcome) => {
      enqueueConversionOutcome(outcome);

      const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

      expect(result.status).toBe(500);
      expect(result.body).toEqual({ error: 'Webhook processing failed' });
    }
  );

  it('returns 500 when the conversion RPC itself fails', async () => {
    supabaseMock.state.queue.push({
      data: null,
      error: { message: 'database unavailable' },
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Webhook processing failed' });
  });
});
