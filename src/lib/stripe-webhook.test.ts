import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processStripeWebhook, verifyCheckoutSessionPaid } from './stripe-webhook';

const stripeMock = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  retrieveSession: vi.fn(),
  retrieveCharge: vi.fn(),
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

const outbidMock = vi.hoisted(() => ({
  sendOutbidNotification: vi.fn(),
}));

vi.mock('@/lib/outbid-notification', () => ({
  sendOutbidNotification: outbidMock.sendOutbidNotification,
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
    charges: {
      retrieve: stripeMock.retrieveCharge,
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
  stripeMock.retrieveCharge.mockReset();
  outbidMock.sendOutbidNotification.mockReset();
  outbidMock.sendOutbidNotification.mockResolvedValue({
    notified: true,
    recipient: 'prev@example.com',
    messageId: 'email-1',
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

describe('bid conversion & idempotent processing (Tasks 4.8+4.9)', () => {
  it('converts the linked pending bid via the ledger RPC with authoritative values', async () => {
    enqueueConversionOutcome('converted');

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(lastRpcCall()?.args[0]).toBe('process_checkout_completed_event');
    expect(lastRpcCall()?.args[1]).toEqual({
      p_event_id: 'evt_123',
      p_event_type: 'checkout.session.completed',
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
      p_event_id: 'evt_123',
      p_event_type: 'checkout.session.completed',
      p_bid_id: 'bid-1000',
      p_stripe_session_id: 'cs_test_abc',
      p_stripe_payment_intent_id: 'pi_test_123',
    });
  });

  it('acknowledges ledger-reported duplicates with 200 and no business effect', async () => {
    enqueueConversionOutcome('duplicate');

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true', duplicate: 'true' });
    expect(stripeMock.retrieveSession).toHaveBeenCalledWith('cs_test_abc');
  });

  it('keeps distinct event ids independently processable', async () => {
    enqueueConversionOutcome('converted');
    enqueueConversionOutcome('converted');

    const first = await processStripeWebhook('raw-payload-a', VALID_SIGNATURE);
    stripeMock.constructEvent.mockReturnValue({ ...COMPLETED_EVENT, id: 'evt_456' });
    const second = await processStripeWebhook('raw-payload-b', VALID_SIGNATURE);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(supabaseMock.state.calls.filter((call) => call.method === 'rpc')).toHaveLength(2);
    const [, secondArgs] = lastRpcCall()?.args ?? [];
    expect((secondArgs as { p_event_id: string }).p_event_id).toBe('evt_456');
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

  it('returns 500 when the processing RPC itself fails', async () => {
    supabaseMock.state.queue.push({
      data: null,
      error: { message: 'database unavailable' },
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Webhook processing failed' });
  });
});

describe('payment failure handling (Task 4.10)', () => {
  const FAILED_EVENT = {
    id: 'evt_fail_1',
    type: 'checkout.session.async_payment_failed',
    data: {
      object: {
        id: 'cs_test_abc',
        client_reference_id: 'bid-1000',
        metadata: { bid_id: 'bid-1000' },
      },
    },
  };

  function enqueueFailedEvent() {
    stripeMock.constructEvent.mockReturnValue(FAILED_EVENT);
    // A failing async payment is authoritatively NOT paid - the default 'paid' mock
    // belongs to the completed-event flow.
    stripeMock.retrieveSession.mockResolvedValue({
      id: 'cs_test_abc',
      payment_status: 'unpaid',
      client_reference_id: 'bid-1000',
      metadata: { bid_id: 'bid-1000' },
    });
  }

  it('marks the linked pending bid failed via the RPC with authoritative values', async () => {
    enqueueFailedEvent();
    supabaseMock.state.queue.push({ data: 'failed', error: null });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true' });
    expect(stripeMock.retrieveSession).toHaveBeenCalledWith('cs_test_abc');
    expect(lastRpcCall()?.args[0]).toBe('fail_pending_bid');
    expect(lastRpcCall()?.args[1]).toEqual({
      p_event_id: 'evt_fail_1',
      p_event_type: 'checkout.session.async_payment_failed',
      p_bid_id: 'bid-1000',
      p_stripe_session_id: 'cs_test_abc',
    });
  });

  it('never fails a bid whose session is authoritatively paid', async () => {
    enqueueFailedEvent();
    stripeMock.retrieveSession.mockResolvedValue({
      id: 'cs_test_abc',
      payment_status: 'paid',
      client_reference_id: 'bid-1000',
      metadata: { bid_id: 'bid-1000' },
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true' });
    expect(supabaseMock.state.calls).toHaveLength(0);
  });

  it('acknowledges ledger-reported duplicates for failure events', async () => {
    enqueueFailedEvent();
    supabaseMock.state.queue.push({ data: 'duplicate', error: null });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true', duplicate: 'true' });
  });

  it('treats repeated failure events of the same session as success without re-failing', async () => {
    enqueueFailedEvent();
    supabaseMock.state.queue.push({ data: 'already_failed', error: null });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
  });

  it('returns 500 when failing the bid reports an anomaly so Stripe retries', async () => {
    enqueueFailedEvent();
    supabaseMock.state.queue.push({ data: 'bid_not_found', error: null });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Webhook processing failed' });
  });

  it('returns 500 when session retrieval fails on the failure path', async () => {
    enqueueFailedEvent();
    stripeMock.retrieveSession.mockRejectedValue(new Error('stripe unavailable'));

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(500);
    expect(supabaseMock.state.calls).toHaveLength(0);
  });

  it('acknowledges failure events without any bid reference and no mutation', async () => {
    enqueueFailedEvent();
    stripeMock.constructEvent.mockReturnValue({
      ...FAILED_EVENT,
      data: { object: { id: 'cs_test_abc', client_reference_id: null, metadata: null } },
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('without bid reference'),
      expect.any(String)
    );
    expect(supabaseMock.state.calls).toHaveLength(0);
  });
});

describe('refund handling (Task 4.11)', () => {
  const REFUNDED_EVENT = {
    id: 'evt_ref_1',
    type: 'charge.refunded',
    data: {
      object: {
        id: 'ch_test_1',
        payment_intent: 'pi_test_123',
        refunded: true,
      },
    },
  };

  function enqueueRefundedEvent() {
    stripeMock.constructEvent.mockReturnValue(REFUNDED_EVENT);
    stripeMock.retrieveCharge.mockResolvedValue({
      id: 'ch_test_1',
      refunded: true,
      payment_intent: 'pi_test_123',
    });
  }

  it('refunds the linked paid bid via the RPC with authoritative values', async () => {
    enqueueRefundedEvent();
    supabaseMock.state.queue.push({ data: 'refunded', error: null });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true' });
    expect(stripeMock.retrieveCharge).toHaveBeenCalledWith('ch_test_1');
    expect(lastRpcCall()?.args[0]).toBe('refund_paid_bid');
    expect(lastRpcCall()?.args[1]).toEqual({
      p_event_id: 'evt_ref_1',
      p_event_type: 'charge.refunded',
      p_stripe_payment_intent_id: 'pi_test_123',
    });
  });

  it('acknowledges ledger-reported duplicates for refund events', async () => {
    enqueueRefundedEvent();
    supabaseMock.state.queue.push({ data: 'duplicate', error: null });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true', duplicate: 'true' });
  });

  it('treats repeats of an already-applied refund as success without re-refunding', async () => {
    enqueueRefundedEvent();
    supabaseMock.state.queue.push({ data: 'already_refunded', error: null });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
  });

  it('does not refund on partial refunds (refunded flag false)', async () => {
    enqueueRefundedEvent();
    stripeMock.retrieveCharge.mockResolvedValue({
      id: 'ch_test_1',
      refunded: false,
      payment_intent: 'pi_test_123',
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('not fully refunded'),
      expect.any(String)
    );
    expect(supabaseMock.state.calls).toHaveLength(0);
  });

  it('cannot link a refund without a string payment_intent', async () => {
    enqueueRefundedEvent();
    stripeMock.constructEvent.mockReturnValue({
      ...REFUNDED_EVENT,
      data: { object: { id: 'ch_test_1', payment_intent: { id: 'pi_obj' } } },
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(stripeMock.retrieveCharge).not.toHaveBeenCalled();
    expect(supabaseMock.state.calls).toHaveLength(0);
  });

  it('returns 500 when the authoritative charge cannot be retrieved', async () => {
    enqueueRefundedEvent();
    stripeMock.retrieveCharge.mockRejectedValue(new Error('stripe unavailable'));

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(500);
    expect(supabaseMock.state.calls).toHaveLength(0);
  });

  it('returns 500 when the refund reports bid_not_found so Stripe retries', async () => {
    enqueueRefundedEvent();
    supabaseMock.state.queue.push({ data: 'bid_not_found', error: null });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Webhook processing failed' });
  });
});

describe('outbid notification dispatch (Task 6.4)', () => {
  it('dispatches the notification exactly once after a first-time conversion', async () => {
    enqueueConversionOutcome('converted');

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true' });
    expect(outbidMock.sendOutbidNotification).toHaveBeenCalledTimes(1);
    expect(outbidMock.sendOutbidNotification).toHaveBeenCalledWith('cs_test_abc');
  });

  it('dispatches on ledger-reported duplicates so failed notifications can retry', async () => {
    enqueueConversionOutcome('duplicate');

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    // Task 6.7 supersedes the old never-dispatch-on-duplicates rule: redelivery is the
    // retry vehicle, while the delivery record gates whether an email actually goes
    // out (covered by the Task 6.7 suite below).
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true', duplicate: 'true' });
    expect(outbidMock.sendOutbidNotification).toHaveBeenCalledTimes(1);
  });

  it('dispatches on already_paid outcomes without re-converting the bid', async () => {
    enqueueConversionOutcome('already_paid');

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(outbidMock.sendOutbidNotification).toHaveBeenCalledTimes(1);
    expect(supabaseMock.state.calls.filter((call) => call.method === 'rpc')).toHaveLength(1);
  });

  it('does not dispatch for unverified sessions', async () => {
    stripeMock.retrieveSession.mockResolvedValue({
      id: 'cs_test_abc',
      payment_status: 'unpaid',
      client_reference_id: 'bid-1000',
      metadata: { bid_id: 'bid-1000' },
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(outbidMock.sendOutbidNotification).not.toHaveBeenCalled();
  });

  it('does not dispatch for payment-failure events', async () => {
    stripeMock.constructEvent.mockReturnValue({
      id: 'evt_fail_9',
      type: 'checkout.session.async_payment_failed',
      data: {
        object: {
          id: 'cs_test_abc',
          client_reference_id: 'bid-1000',
          metadata: { bid_id: 'bid-1000' },
        },
      },
    });
    stripeMock.retrieveSession.mockResolvedValue({
      id: 'cs_test_abc',
      payment_status: 'unpaid',
      client_reference_id: 'bid-1000',
      metadata: { bid_id: 'bid-1000' },
    });
    supabaseMock.state.queue.push({ data: 'failed', error: null });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(outbidMock.sendOutbidNotification).not.toHaveBeenCalled();
  });

  it('does not dispatch for refund events', async () => {
    stripeMock.constructEvent.mockReturnValue({
      id: 'evt_ref_9',
      type: 'charge.refunded',
      data: {
        object: { id: 'ch_test_1', payment_intent: 'pi_test_123', refunded: true },
      },
    });
    stripeMock.retrieveCharge.mockResolvedValue({
      id: 'ch_test_1',
      refunded: true,
      payment_intent: 'pi_test_123',
    });
    supabaseMock.state.queue.push({ data: 'refunded', error: null });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(outbidMock.sendOutbidNotification).not.toHaveBeenCalled();
  });

  it('keeps the payment response successful when the email provider fails', async () => {
    enqueueConversionOutcome('converted');
    outbidMock.sendOutbidNotification.mockRejectedValue(
      new Error('Failed to send email: provider down')
    );

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true' });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('outbid notification failed'),
      expect.any(String)
    );
  });

  it('logs skipped notifications without failing the delivery', async () => {
    enqueueConversionOutcome('converted');
    outbidMock.sendOutbidNotification.mockResolvedValue({
      notified: false,
      reason: 'no_previous_bidder',
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('outbid notification skipped'),
      expect.any(String)
    );
  });
});

describe('email failure handling (Task 6.7)', () => {
  it('answers 500 after conversion when the send failed with an unconfirmed outcome', async () => {
    enqueueConversionOutcome('converted');
    outbidMock.sendOutbidNotification.mockResolvedValue({
      notified: false,
      reason: 'send_failed',
      retryable: true,
      attempts: 1,
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Outbid notification retry scheduled' });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('answering 500 so Stripe redelivers'),
      expect.any(String)
    );
  });

  it('answers 200 for terminal provider rejections so Stripe stops retrying', async () => {
    enqueueConversionOutcome('converted');
    outbidMock.sendOutbidNotification.mockResolvedValue({
      notified: false,
      reason: 'send_failed',
      retryable: false,
      attempts: 1,
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true' });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('permanently rejected'),
      expect.any(String)
    );
  });

  it('retries the notification on duplicate deliveries of the same event', async () => {
    enqueueConversionOutcome('duplicate');
    outbidMock.sendOutbidNotification.mockResolvedValue({
      notified: true,
      recipient: 'prev@example.com',
      messageId: 'email-retry-1',
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    // Payment stays exactly-once (ledger duplicate), while the email gets its retry.
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true', duplicate: 'true' });
    expect(outbidMock.sendOutbidNotification).toHaveBeenCalledTimes(1);
    expect(lastRpcCall()?.args[0]).toBe('process_checkout_completed_event');
  });

  it('keeps requesting retries while duplicate deliveries still fail retryably', async () => {
    enqueueConversionOutcome('duplicate');
    outbidMock.sendOutbidNotification.mockResolvedValue({
      notified: false,
      reason: 'send_failed',
      retryable: true,
      attempts: 2,
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Outbid notification retry scheduled' });
  });

  it('never resends an already-sent delivery on duplicate deliveries', async () => {
    enqueueConversionOutcome('duplicate');
    outbidMock.sendOutbidNotification.mockResolvedValue({
      notified: false,
      reason: 'already_sent',
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true', duplicate: 'true' });
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('outbid notification skipped'),
      expect.any(String)
    );
  });

  it('uses already_paid redeliveries as a retry vehicle without re-converting', async () => {
    enqueueConversionOutcome('already_paid');
    outbidMock.sendOutbidNotification.mockResolvedValue({
      notified: false,
      reason: 'send_failed',
      retryable: true,
      attempts: 2,
    });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(500);
    expect(supabaseMock.state.calls.filter((call) => call.method === 'rpc')).toHaveLength(1);
  });

  it('treats unexpected notification errors as best-effort and answers 200', async () => {
    enqueueConversionOutcome('converted');
    outbidMock.sendOutbidNotification.mockRejectedValue(new Error('database unavailable'));

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true' });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed unexpectedly'),
      expect.any(String)
    );
  });

  it('does not dispatch notifications for payment-failure events even on duplicates', async () => {
    stripeMock.constructEvent.mockReturnValue({
      id: 'evt_fail_10',
      type: 'checkout.session.async_payment_failed',
      data: {
        object: {
          id: 'cs_test_abc',
          client_reference_id: 'bid-1000',
          metadata: { bid_id: 'bid-1000' },
        },
      },
    });
    stripeMock.retrieveSession.mockResolvedValue({
      id: 'cs_test_abc',
      payment_status: 'unpaid',
      client_reference_id: 'bid-1000',
      metadata: { bid_id: 'bid-1000' },
    });
    supabaseMock.state.queue.push({ data: 'failed', error: null });

    const result = await processStripeWebhook('raw-payload', VALID_SIGNATURE);

    expect(result.status).toBe(200);
    expect(outbidMock.sendOutbidNotification).not.toHaveBeenCalled();
  });
});
