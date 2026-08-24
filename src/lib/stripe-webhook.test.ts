import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processStripeWebhook } from './stripe-webhook';

const stripeMock = vi.hoisted(() => ({
  constructEvent: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: {
      constructEvent: stripeMock.constructEvent,
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
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('processStripeWebhook', () => {
  it('returns 200 received for a verified plan-required event', () => {
    const result = processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true' });
    expect(stripeMock.constructEvent).toHaveBeenCalledWith(
      'raw-payload',
      VALID_SIGNATURE,
      'whsec_test'
    );
  });

  it('passes the raw payload to verification without parsing it first', () => {
    processStripeWebhook('{"weird":"but raw"}', VALID_SIGNATURE);

    expect(stripeMock.constructEvent).toHaveBeenCalledWith(
      '{"weird":"but raw"}',
      VALID_SIGNATURE,
      'whsec_test'
    );
  });

  it('acknowledges and ignores unsupported event types with 200', () => {
    stripeMock.constructEvent.mockReturnValue({
      ...COMPLETED_EVENT,
      id: 'evt_456',
      type: 'invoice.paid',
    });

    const result = processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true', ignored: 'true' });
  });

  it('returns 400 when signature verification fails', () => {
    stripeMock.constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });

    const result = processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Invalid signature' });
  });

  it.each([undefined, null, ''])('returns 400 when the signature header is %p', (signature) => {
    const result = processStripeWebhook('raw-payload', signature ?? null);

    expect(result.status).toBe(400);
    expect(stripeMock.constructEvent).not.toHaveBeenCalled();
  });

  it('returns 400 when the payload is empty or not raw text', () => {
    const result = processStripeWebhook('', VALID_SIGNATURE);

    expect(result.status).toBe(400);
    expect(stripeMock.constructEvent).not.toHaveBeenCalled();
  });

  it('returns 500 when the webhook secret is not configured', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');

    const result = processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(500);
    expect(stripeMock.constructEvent).not.toHaveBeenCalled();
  });

  it('returns 200 for duplicate/replayed verified events with no side effects', () => {
    const first = processStripeWebhook('raw-payload', VALID_SIGNATURE);
    const second = processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(stripeMock.constructEvent).toHaveBeenCalledTimes(2);
  });

  it('returns 500 on unexpected processing failures so Stripe retries', () => {
    const throwingEvent = {
      id: 'evt_789',
      type: 'checkout.session.completed',
      get data(): never {
        throw new Error('malformed event envelope');
      },
    };
    stripeMock.constructEvent.mockReturnValue(throwingEvent as never);

    const result = processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Webhook processing failed' });
  });
});
