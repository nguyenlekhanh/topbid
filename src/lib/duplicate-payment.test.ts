import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processStripeWebhook, type WebhookProcessingResult } from './stripe-webhook';

/**
 * Task 9.9 — Duplicate payment testing.
 *
 * Unlike the Task 4.x webhook suites (stateless per-delivery outcome checks), this suite
 * models the DATABASE IDEMPOTENCY BOUNDARY as persistent state shared across deliveries,
 * mirroring the exact claim/transition semantics of the production RPCs:
 *
 * - processed_webhook_events PK(event.id) arbitration (migration 20260823000011):
 *   a claimed event id answers 'duplicate'; successful claims COMMIT; raising anomaly
 *   outcomes (bid_not_found/invalid_state/session_mismatch) ROLL BACK the claim so the
 *   event stays retryable - exactly as the PL/pgSQL wrappers do.
 * - convert_pending_bid_to_paid bid identity (migration 20260823000010): pending -> paid
 *   once per session; same-session replays answer 'already_paid' without re-converting.
 * - fail_pending_bid (migration 20260823000012): never downgrades 'paid', repeats answer
 *   'already_failed'/'duplicate'.
 * - refund_paid_bid (migration 20260823000013): keyed on stripe_payment_intent_id;
 *   replays answer 'already_refunded'/'duplicate'.
 *
 * With that boundary in place, every test drives the REAL processStripeWebhook endpoint
 * through full delivery sequences - sequential redeliveries, simultaneous dispatches,
 * cross-event-type interleavings - and asserts payment exactly-once from the outside:
 * response statuses/bodies, applied state transitions, and ledger occupancy.
 */

type RpcArgs = Record<string, unknown>;
type RpcResult = { data: string | null; error: { message: string } | null };

const RAISING_OUTCOMES = new Set(['bid_not_found', 'invalid_state', 'session_mismatch']);

function createLedgerDb() {
  const claimedEvents = new Set<string>();
  const statusBySession = new Map<string, string>();
  const statusByPaymentIntent = new Map<string, string>();
  const transitions: string[] = [];

  function claim(eventId: string): boolean {
    if (claimedEvents.has(eventId)) {
      return false;
    }
    claimedEvents.add(eventId);
    return true;
  }

  function settle(eventId: string, outcome: string): RpcResult {
    // Mirrors transaction semantics: normal returns commit the claim, raises roll it back.
    if (RAISING_OUTCOMES.has(outcome)) {
      claimedEvents.delete(eventId);
    }
    return { data: outcome, error: null };
  }

  return {
    transitions,
    isClaimed: (eventId: string) => claimedEvents.has(eventId),
    seedPendingBid(sessionId: string, paymentIntentId: string) {
      statusBySession.set(sessionId, 'pending');
      statusByPaymentIntent.set(paymentIntentId, 'pending');
    },
    rpc(name: string, args: RpcArgs): Promise<RpcResult> {
      const eventId = String(args.p_event_id);

      if (name === 'process_checkout_completed_event') {
        const sessionId = String(args.p_stripe_session_id);
        const paymentIntentId = args.p_stripe_payment_intent_id;

        if (!claim(eventId)) {
          return Promise.resolve(settle(eventId, 'duplicate'));
        }

        const status = statusBySession.get(sessionId);
        if (status === undefined) {
          return Promise.resolve(settle(eventId, 'bid_not_found'));
        }
        if (status === 'paid') {
          return Promise.resolve(settle(eventId, 'already_paid'));
        }
        if (status !== 'pending') {
          return Promise.resolve(settle(eventId, 'invalid_state'));
        }

        statusBySession.set(sessionId, 'paid');
        if (typeof paymentIntentId === 'string') {
          statusByPaymentIntent.set(paymentIntentId, 'paid');
        }
        transitions.push(`paid:${sessionId}`);
        return Promise.resolve(settle(eventId, 'converted'));
      }

      if (name === 'fail_pending_bid') {
        const sessionId = String(args.p_stripe_session_id);

        if (!claim(eventId)) {
          return Promise.resolve(settle(eventId, 'duplicate'));
        }

        const status = statusBySession.get(sessionId);
        if (status === undefined) {
          return Promise.resolve(settle(eventId, 'bid_not_found'));
        }
        if (status === 'paid') {
          return Promise.resolve(settle(eventId, 'already_paid'));
        }
        if (status === 'failed') {
          return Promise.resolve(settle(eventId, 'already_failed'));
        }
        if (status !== 'pending') {
          return Promise.resolve(settle(eventId, 'invalid_state'));
        }

        statusBySession.set(sessionId, 'failed');
        transitions.push(`failed:${sessionId}`);
        return Promise.resolve(settle(eventId, 'failed'));
      }

      if (name === 'refund_paid_bid') {
        const paymentIntentId = String(args.p_stripe_payment_intent_id);

        if (!claim(eventId)) {
          return Promise.resolve(settle(eventId, 'duplicate'));
        }

        const status = statusByPaymentIntent.get(paymentIntentId);
        if (status === undefined) {
          return Promise.resolve(settle(eventId, 'bid_not_found'));
        }
        if (status === 'refunded') {
          return Promise.resolve(settle(eventId, 'already_refunded'));
        }
        if (status !== 'paid') {
          return Promise.resolve(settle(eventId, 'invalid_state'));
        }

        statusByPaymentIntent.set(paymentIntentId, 'refunded');
        transitions.push(`refunded:${paymentIntentId}`);
        return Promise.resolve(settle(eventId, 'refunded'));
      }

      return Promise.resolve({ data: null, error: { message: `unexpected rpc "${name}"` } });
    },
  };
}

const harness = vi.hoisted(() => {
  const state = {
    db: null as ReturnType<typeof createLedgerDb> | null,
    eventFactory: null as null | (() => Record<string, unknown>),
    sessionResponse: null as unknown,
    chargeResponse: null as unknown,
    sessionShouldReject: false,
    constructCalls: [] as Array<{ payload: string; signature: string }>,
  };
  return state;
});

const outbidMock = vi.hoisted(() => ({
  sendOutbidNotification: vi.fn(),
}));

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    rpc: (name: string, args: RpcArgs) => Promise.resolve().then(() => harness.db!.rpc(name, args)),
  }),
}));

vi.mock('@/lib/outbid-notification', () => ({
  sendOutbidNotification: outbidMock.sendOutbidNotification,
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: {
      constructEvent: (payload: string, signature: string, secret: string, tolerance: number) => {
        void secret;
        void tolerance;
        harness.constructCalls.push({ payload, signature });
        return harness.eventFactory!();
      },
    },
    checkout: {
      sessions: {
        retrieve: () => {
          if (harness.sessionShouldReject) {
            return Promise.reject(new Error('stripe unavailable'));
          }
          return Promise.resolve(harness.sessionResponse);
        },
      },
    },
    charges: {
      retrieve: () => Promise.resolve(harness.chargeResponse),
    },
  },
}));

const SIGNATURE = 't=1760000000,v1=signature';
const SESSION_ID = 'cs_test_1';
const PAYMENT_INTENT_ID = 'pi_test_1';
const RAW_PAYLOAD = 'raw-payload';

function paidSessionResponse() {
  return {
    id: SESSION_ID,
    payment_status: 'paid',
    client_reference_id: 'bid-1',
    metadata: { bid_id: 'bid-1' },
    payment_intent: PAYMENT_INTENT_ID,
  };
}

function unpaidSessionResponse() {
  return { ...paidSessionResponse(), payment_status: 'unpaid' };
}

function completedEvent(id: string) {
  return {
    id,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: SESSION_ID,
        client_reference_id: 'bid-1',
        metadata: { bid_id: 'bid-1' },
      },
    },
  };
}

function failedEvent(id: string) {
  return {
    id,
    type: 'checkout.session.async_payment_failed',
    data: {
      object: {
        id: SESSION_ID,
        client_reference_id: 'bid-1',
        metadata: { bid_id: 'bid-1' },
      },
    },
  };
}

function refundedEvent(id: string, paymentIntentId: string = PAYMENT_INTENT_ID) {
  return {
    id,
    type: 'charge.refunded',
    data: {
      object: {
        id: 'ch_test_1',
        payment_intent: paymentIntentId,
        refunded: true,
      },
    },
  };
}

function fullyRefundedCharge(paymentIntentId: string = PAYMENT_INTENT_ID) {
  return { id: 'ch_test_1', refunded: true, payment_intent: paymentIntentId };
}

async function deliver(eventId: string): Promise<WebhookProcessingResult> {
  harness.eventFactory = () => completedEvent(eventId);
  return processStripeWebhook(RAW_PAYLOAD, SIGNATURE);
}

beforeEach(() => {
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
  harness.db = createLedgerDb();
  harness.eventFactory = () => completedEvent('evt_1');
  harness.sessionResponse = paidSessionResponse();
  harness.sessionShouldReject = false;
  harness.chargeResponse = fullyRefundedCharge();
  harness.constructCalls = [];
  outbidMock.sendOutbidNotification.mockReset();
  outbidMock.sendOutbidNotification.mockResolvedValue({ notified: true });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('same-event redelivery (Task 9.9)', () => {
  it('converts exactly once, then acknowledges identical redeliveries as duplicates', async () => {
    harness.db!.seedPendingBid(SESSION_ID, PAYMENT_INTENT_ID);

    const first = await deliver('evt_1');
    const second = await deliver('evt_1');
    const third = await deliver('evt_1');

    expect(first).toEqual({ status: 200, body: { received: 'true' } });
    expect(second).toEqual({ status: 200, body: { received: 'true', duplicate: 'true' } });
    expect(third).toEqual({ status: 200, body: { received: 'true', duplicate: 'true' } });
    expect(harness.db!.transitions).toEqual([`paid:${SESSION_ID}`]);
  });

  it('five simultaneous deliveries of one event id yield one conversion and four duplicates', async () => {
    harness.db!.seedPendingBid(SESSION_ID, PAYMENT_INTENT_ID);

    const results = await Promise.all(Array.from({ length: 5 }, () => deliver('evt_1')));

    expect(results.every((result) => result.status === 200)).toBe(true);
    const conversions = results.filter((result) => result.body.duplicate !== 'true');
    const duplicates = results.filter((result) => result.body.duplicate === 'true');
    expect(conversions).toHaveLength(1);
    expect(duplicates).toHaveLength(4);
    expect(harness.db!.transitions).toEqual([`paid:${SESSION_ID}`]);
  });

  it('never short-circuits replay protection: every delivery re-verifies the signature', async () => {
    harness.db!.seedPendingBid(SESSION_ID, PAYMENT_INTENT_ID);

    await deliver('evt_1');
    await deliver('evt_1');
    await deliver('evt_1');

    // The raw payload + signature go through constructEvent on EVERY delivery -
    // duplicates are arbitrated by the ledger downstream, never by skipping verification.
    expect(harness.constructCalls).toHaveLength(3);
    expect(
      harness.constructCalls.every(
        (call) => call.payload === RAW_PAYLOAD && call.signature === SIGNATURE
      )
    ).toBe(true);
  });

  it('unverified unpaid completions occupy no ledger space and cannot block later conversion', async () => {
    harness.db!.seedPendingBid(SESSION_ID, PAYMENT_INTENT_ID);
    harness.sessionResponse = unpaidSessionResponse();

    const unverifiedFirst = await deliver('evt_1');
    const unverifiedSecond = await deliver('evt_1');

    expect(unverifiedFirst.status).toBe(200);
    expect(unverifiedSecond.status).toBe(200);
    expect(harness.db!.isClaimed('evt_1')).toBe(false);

    harness.sessionResponse = paidSessionResponse();
    const verified = await deliver('evt_1');

    expect(verified).toEqual({ status: 200, body: { received: 'true' } });
    expect(harness.db!.transitions).toEqual([`paid:${SESSION_ID}`]);
  });
});

describe('distinct events for one session - bid-identity arbitration (Task 9.9)', () => {
  it('acknowledges a second distinct completed event without re-converting the session', async () => {
    harness.db!.seedPendingBid(SESSION_ID, PAYMENT_INTENT_ID);

    const first = await deliver('evt_A');
    const second = await deliver('evt_B');

    expect(first.body.duplicate).toBeUndefined();
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBeUndefined();
    expect(harness.db!.transitions).toEqual([`paid:${SESSION_ID}`]);
    expect(harness.db!.isClaimed('evt_A')).toBe(true);
    expect(harness.db!.isClaimed('evt_B')).toBe(true);
  });

  it('concurrent distinct events for the same pending session convert exactly once', async () => {
    harness.db!.seedPendingBid(SESSION_ID, PAYMENT_INTENT_ID);

    const [a, b] = await Promise.all([deliver('evt_A'), deliver('evt_B')]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.duplicate).toBeUndefined();
    expect(b.body.duplicate).toBeUndefined();
    expect(harness.db!.transitions).toEqual([`paid:${SESSION_ID}`]);
  });
});

describe('failure-path duplicate safety (Task 9.9)', () => {
  function deliverFailure(eventId: string): Promise<WebhookProcessingResult> {
    harness.eventFactory = () => failedEvent(eventId);
    return processStripeWebhook(RAW_PAYLOAD, SIGNATURE);
  }

  it('marks failed exactly once across repeated failure deliveries', async () => {
    harness.db!.seedPendingBid(SESSION_ID, PAYMENT_INTENT_ID);
    harness.sessionResponse = unpaidSessionResponse();

    const first = await deliverFailure('evt_F1');
    const second = await deliverFailure('evt_F1');
    const third = await deliverFailure('evt_F2');

    expect(first.body).toEqual({ received: 'true' });
    expect(second.body).toEqual({ received: 'true', duplicate: 'true' });
    expect(third.body.duplicate).toBeUndefined();
    expect(harness.db!.transitions).toEqual([`failed:${SESSION_ID}`]);
  });

  it('a failure notice for an authoritatively paid session never touches the database', async () => {
    harness.db!.seedPendingBid(SESSION_ID, PAYMENT_INTENT_ID);
    harness.sessionResponse = paidSessionResponse();

    const result = await deliverFailure('evt_F_late');

    expect(result).toEqual({ status: 200, body: { received: 'true' } });
    expect(harness.db!.transitions).toEqual([]);
    expect(harness.db!.isClaimed('evt_F_late')).toBe(false);
  });

  it('refuses to downgrade a paid bid even when the authoritative Stripe read lags the conversion', async () => {
    // Strongest ordering-hazard variant: the failure delivery's Stripe retrieval still
    // observes 'unpaid' (stale read) even though the conversion already committed - the
    // DB-level state machine itself must refuse the downgrade via 'already_paid'.
    harness.db!.seedPendingBid(SESSION_ID, PAYMENT_INTENT_ID);
    await deliver('evt_pay');

    harness.sessionResponse = unpaidSessionResponse();
    const staleFailure = await deliverFailure('evt_F_stale');

    expect(staleFailure).toEqual({ status: 200, body: { received: 'true' } });
    expect(harness.db!.transitions).toEqual([`paid:${SESSION_ID}`]);
    expect(harness.db!.isClaimed('evt_F_stale')).toBe(true);
  });

  it('simultaneous cross-type deliveries of distinct events land exactly one effect, loudly', async () => {
    // Real Stripe events carry distinct ids. Under simultaneous dispatch the failure
    // delivery reaches the ledger first (its path has fewer verification hops than the
    // completion's authoritative re-retrieval chain). Whatever the interleaving, the
    // guarantees hold: exactly one terminal effect, the loser answered loudly (completion
    // -> 500 anomaly) and its claim rolls back so the event stays retryable.
    harness.db!.seedPendingBid(SESSION_ID, PAYMENT_INTENT_ID);
    harness.sessionResponse = unpaidSessionResponse();

    const failurePromise = deliverFailure('evt_F');
    harness.sessionResponse = paidSessionResponse();
    const completionPromise = deliver('evt_C');

    const failureResult = await failurePromise;
    const completionResult = await completionPromise;

    expect(failureResult).toEqual({ status: 200, body: { received: 'true' } });
    expect(completionResult).toEqual({
      status: 500,
      body: { error: 'Webhook processing failed' },
    });
    expect(harness.db!.transitions).toEqual([`failed:${SESSION_ID}`]);
    expect(harness.db!.isClaimed('evt_F')).toBe(true);
    expect(harness.db!.isClaimed('evt_C')).toBe(false);
  });

  it('a completed event for an already-failed session surfaces the anomaly as 500 with a rolled-back claim', async () => {
    harness.db!.seedPendingBid(SESSION_ID, PAYMENT_INTENT_ID);
    harness.sessionResponse = unpaidSessionResponse();

    const failureDelivery = await deliverFailure('evt_F_order');
    expect(failureDelivery).toEqual({ status: 200, body: { received: 'true' } });

    // The bid is now terminal ('failed'); a late completion (distinct real-world event
    // id) is an anomaly answered 500 so monitoring sees it and Stripe retries while the
    // underlying issue persists...
    harness.sessionResponse = paidSessionResponse();
    const lateCompletion = await deliver('evt_C_late');

    expect(lateCompletion).toEqual({ status: 500, body: { error: 'Webhook processing failed' } });
    // ...and the claim rollback keeps the SAME event id retryable for a corrected world.
    expect(harness.db!.isClaimed('evt_C_late')).toBe(false);
    expect(harness.db!.transitions).toEqual([`failed:${SESSION_ID}`]);
  });
});

describe('refund replay safety (Task 9.9)', () => {
  function deliverRefund(
    eventId: string,
    paymentIntentId: string = PAYMENT_INTENT_ID
  ): Promise<WebhookProcessingResult> {
    harness.eventFactory = () => refundedEvent(eventId, paymentIntentId);
    harness.chargeResponse = fullyRefundedCharge(paymentIntentId);
    return processStripeWebhook(RAW_PAYLOAD, SIGNATURE);
  }

  it('applies a refund exactly once across duplicate and distinct refund events', async () => {
    harness.db!.seedPendingBid(SESSION_ID, PAYMENT_INTENT_ID);
    await deliver('evt_pay'); // pending -> paid

    const refundFirst = await deliverRefund('evt_R1');
    const refundReplay = await deliverRefund('evt_R1');
    const refundDistinct = await deliverRefund('evt_R2');

    expect(refundFirst.body).toEqual({ received: 'true' });
    expect(refundReplay).toEqual({ status: 200, body: { received: 'true', duplicate: 'true' } });
    expect(refundDistinct.status).toBe(200);
    expect(refundDistinct.body.duplicate).toBeUndefined();
    expect(harness.db!.transitions).toEqual([
      `paid:${SESSION_ID}`,
      `refunded:${PAYMENT_INTENT_ID}`,
    ]);
  });

  it('a refund referencing an unknown payment intent fails loudly and stays retryable', async () => {
    harness.db!.seedPendingBid(SESSION_ID, PAYMENT_INTENT_ID);

    const result = await deliverRefund('evt_R_unknown', 'pi_unknown');

    expect(result).toEqual({ status: 500, body: { error: 'Webhook processing failed' } });
    expect(harness.db!.isClaimed('evt_R_unknown')).toBe(false);
    expect(harness.db!.transitions).toEqual([]);
  });
});

describe('full lifecycle monotonicity (Task 9.9)', () => {
  function deliverFailure(eventId: string): Promise<WebhookProcessingResult> {
    harness.eventFactory = () => failedEvent(eventId);
    return processStripeWebhook(RAW_PAYLOAD, SIGNATURE);
  }

  function deliverRefund(eventId: string): Promise<WebhookProcessingResult> {
    harness.eventFactory = () => refundedEvent(eventId);
    harness.chargeResponse = fullyRefundedCharge();
    return processStripeWebhook(RAW_PAYLOAD, SIGNATURE);
  }

  it('conversion, duplicates, contradictory failure, refund and refund replays stay consistent', async () => {
    harness.db!.seedPendingBid(SESSION_ID, PAYMENT_INTENT_ID);

    const paid = await deliver('evt_L1');
    const paidDuplicate = await deliver('evt_L1');
    harness.sessionResponse = unpaidSessionResponse(); // contradictory notice arrives
    const contradiction = await deliverFailure('evt_L2'); // authoritative check still says paid
    harness.sessionResponse = paidSessionResponse();
    const refunded = await deliverRefund('evt_L3');
    const refundedReplay = await deliverRefund('evt_L3');
    const refundedDistinct = await deliverRefund('evt_L4');

    expect(paid.status).toBe(200);
    expect(paidDuplicate.body.duplicate).toBe('true');
    expect(contradiction.status).toBe(200); // ignored without mutation, no downgrade
    expect(refunded.status).toBe(200);
    expect(refundedReplay.body.duplicate).toBe('true');
    expect(refundedDistinct.status).toBe(200);

    // Terminal-state monotonicity: exactly one paid transition and exactly one refund,
    // in order; the contradictory failure never downgraded the paid bid.
    expect(harness.db!.transitions).toEqual([
      `paid:${SESSION_ID}`,
      `refunded:${PAYMENT_INTENT_ID}`,
    ]);
    expect(
      [paid, paidDuplicate, contradiction, refunded, refundedReplay, refundedDistinct].every(
        (result) => result.status === 200
      )
    ).toBe(true);
  });
});
