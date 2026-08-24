import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processStripeWebhook, verifyCheckoutSessionPaid } from './stripe-webhook';

const stripeMock = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  retrieveSession: vi.fn(),
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
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('processStripeWebhook', () => {
  it('returns 200 received for a verified plan-required event', async () => {
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
  });

  it('returns 500 when the authoritative session cannot be retrieved', async () => {
    stripeMock.retrieveSession.mockRejectedValue(new Error('stripe unavailable'));

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Webhook processing failed' });
  });

  it('does not consult Stripe for unsupported event types', async () => {
    stripeMock.constructEvent.mockReturnValue({
      ...COMPLETED_EVENT,
      type: 'invoice.paid',
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(stripeMock.retrieveSession).not.toHaveBeenCalled();
  });
});
