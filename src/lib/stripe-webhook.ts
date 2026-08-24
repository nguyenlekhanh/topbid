import { sendOutbidNotification, type OutbidNotificationResult } from '@/lib/outbid-notification';
import { createServiceClient } from '@/lib/supabase-service';
import { stripe } from '@/lib/stripe';

/**
 * Core logic for the Stripe webhook endpoint (Task 4.5).
 *
 * Trust boundary: the raw request payload is passed to constructEvent UNMODIFIED -
 * never parsed or re-serialized beforehand - together with the signature header and
 * STRIPE_WEBHOOK_SECRET. Payloads are untrusted until verification succeeds.
 *
 * Event routing (only types required by PROJECT_PLAN.md):
 * - checkout.session.completed: acknowledged; the bid linkage (client_reference_id /
 *   metadata.bid_id) is extracted for downstream tasks - converting the pending bid to
 *   paid happens in Task 4.8, payment-status checks in Task 4.7
 * - anything else: acknowledged and ignored (Stripe best practice: unknown/other events
 *   return success so retries stop)
 *
 * HTTP semantics returned via status:
 * - 400: missing/invalid signature or failed verification
 * - 500: server misconfiguration (missing secret) or unexpected processing failure
 * - 200: event verified and handled/acknowledged
 */

export type WebhookProcessingResult = {
  status: number;
  body: Record<string, string>;
};

export type PaymentVerificationFailureReason =
  'missing_bid_reference' | 'session_not_paid' | 'reference_mismatch';

export type PaymentVerificationResult =
  | {
      verified: true;
      sessionId: string;
      bidReference: string;
      paymentIntentId: string | null;
    }
  | { verified: false; reason: PaymentVerificationFailureReason; sessionId: string };

/**
 * Verify authoritatively that a Checkout Session is actually paid (Task 4.7).
 *
 * - The webhook EVENT body is never trusted for payment state: the session is retrieved
 *   again from Stripe's server-side API by its identifier, and that response is the
 *   source of truth
 * - Authoritative check: session.payment_status === 'paid' ('unpaid' covers async
 *   payment methods still processing; 'no_payment_required' does not apply to paid bids)
 * - Linkage consistency: client_reference_id and metadata.bid_id are both set by our own
 *   Task 4.2 creation code to the same bid id - a mismatch or full absence means the
 *   session cannot be safely attributed, so it is rejected
 * - Retrieval failures throw so the endpoint responds 500 and Stripe retries
 * - No database access and no status mutation here: conversion is Task 4.8
 */
export async function verifyCheckoutSessionPaid(
  sessionId: string
): Promise<PaymentVerificationResult> {
  let session;

  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Failed to retrieve Checkout Session "${sessionId}": ${message}`);
  }

  if (session.payment_status !== 'paid') {
    return {
      verified: false,
      reason: 'session_not_paid',
      sessionId: session.id,
    };
  }

  const clientReferenceId = session.client_reference_id ?? null;
  const metadataBidId = session.metadata?.bid_id ?? null;

  if (!clientReferenceId && !metadataBidId) {
    return {
      verified: false,
      reason: 'missing_bid_reference',
      sessionId: session.id,
    };
  }

  if (clientReferenceId && metadataBidId && clientReferenceId !== metadataBidId) {
    return {
      verified: false,
      reason: 'reference_mismatch',
      sessionId: session.id,
    };
  }

  return {
    verified: true,
    sessionId: session.id,
    bidReference: clientReferenceId ?? metadataBidId!,
    // The SDK types payment_intent as string | PaymentIntent | null (expandable);
    // we never expand it, and only the identifier string is ever persisted.
    paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
  };
}

export type ConversionOutcome =
  | 'converted'
  | 'already_paid'
  | 'duplicate'
  | 'failed'
  | 'already_failed'
  | 'refunded'
  | 'already_refunded'
  | 'bid_not_found'
  | 'invalid_state'
  | 'session_mismatch';

const KNOWN_CONVERSION_OUTCOMES: readonly ConversionOutcome[] = [
  'converted',
  'already_paid',
  'duplicate',
  'failed',
  'already_failed',
  'refunded',
  'already_refunded',
  'bid_not_found',
  'invalid_state',
  'session_mismatch',
];

/**
 * Claim the event in the idempotency ledger and apply the verified conversion inside a
 * single database transaction (Task 4.9).
 * - The event.id PRIMARY KEY is the race-safe arbiter: concurrent deliveries serialize
 *   on it and the loser receives outcome 'duplicate' without any business effect
 * - Anomaly outcomes raise inside the RPC, rolling back BOTH the conversion AND the
 *   ledger claim, so failed processing leaves the event retryable
 * - RPC errors throw so the endpoint responds 500 and Stripe retries
 */
async function processVerifiedEvent(
  eventId: string,
  eventType: string,
  bidId: string,
  sessionId: string,
  paymentIntentId: string | null
): Promise<ConversionOutcome> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc('process_checkout_completed_event', {
    p_event_id: eventId,
    p_event_type: eventType,
    p_bid_id: bidId,
    p_stripe_session_id: sessionId,
    p_stripe_payment_intent_id: paymentIntentId,
  });

  if (error) {
    throw new Error(`Failed to process webhook event: ${error.message}`);
  }

  const outcome = data as ConversionOutcome;

  if (!KNOWN_CONVERSION_OUTCOMES.includes(outcome)) {
    throw new Error(`Failed to process webhook event: unknown outcome "${String(data)}"`);
  }

  return outcome;
}

/**
 * Apply the verified failure transition at the database boundary (Task 4.10).
 * - Delegates to the fail_pending_bid RPC: ledger claim + state transition in one
 *   transaction; duplicate claims and already-settled bids return success/no-op
 *   outcomes; anomalies raise inside the RPC, rolling back the claim so the event stays
 *   retryable
 * - RPC errors throw so the endpoint responds 500 and Stripe retries
 */
async function failVerifiedBid(
  eventId: string,
  eventType: string,
  bidId: string,
  sessionId: string
): Promise<ConversionOutcome> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc('fail_pending_bid', {
    p_event_id: eventId,
    p_event_type: eventType,
    p_bid_id: bidId,
    p_stripe_session_id: sessionId,
  });

  if (error) {
    throw new Error(`Failed to process payment-failure event: ${error.message}`);
  }

  const outcome = data as ConversionOutcome;

  if (!KNOWN_CONVERSION_OUTCOMES.includes(outcome)) {
    throw new Error(`Failed to process payment-failure event: unknown outcome "${String(data)}"`);
  }

  return outcome;
}

/**
 * Apply the verified refund at the database boundary (Task 4.11).
 * - Delegates to the refund_paid_bid RPC: ledger claim + transition in one transaction;
 *   duplicate claims and already-refunded bids return success/no-op outcomes; anomalies
 *   raise inside the RPC, rolling back the claim so the event stays retryable
 * - Links authoritatively via stripe_payment_intent_id persisted by Task 4.8
 * - RPC errors throw so the endpoint responds 500 and Stripe retries
 */
async function refundVerifiedBid(
  eventId: string,
  eventType: string,
  paymentIntentId: string
): Promise<ConversionOutcome> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc('refund_paid_bid', {
    p_event_id: eventId,
    p_event_type: eventType,
    p_stripe_payment_intent_id: paymentIntentId,
  });

  if (error) {
    throw new Error(`Failed to process refund event: ${error.message}`);
  }

  const outcome = data as ConversionOutcome;

  if (!KNOWN_CONVERSION_OUTCOMES.includes(outcome)) {
    throw new Error(`Failed to process refund event: unknown outcome "${String(data)}"`);
  }

  return outcome;
}

/**
 * Replay-protection window for signature timestamps, in seconds.
 * This is Stripe's default tolerance, made explicit so review and tests can pin it;
 * events with older timestamps fail verification.
 */
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

const SUPPORTED_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_failed',
  'charge.refunded',
]);

type StripeLikeEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: {
      id?: string;
      client_reference_id?: string | null;
      metadata?: Record<string, string> | null;
      payment_intent?: string | { id?: string } | null;
      refunded?: boolean;
    };
  };
};

function extractSessionReferences(event: StripeLikeEvent): {
  sessionId: string;
  clientReferenceId: string | null;
  bidId: string | null;
} {
  const object = event.data?.object ?? {};

  return {
    sessionId: object.id ?? 'unknown',
    clientReferenceId: object.client_reference_id ?? null,
    bidId: object.metadata?.bid_id ?? null,
  };
}

async function handleAsyncPaymentFailed(
  event: StripeLikeEvent
): Promise<ConversionOutcome | 'unverified'> {
  // Task 4.10: authoritative check before mutating - a session Stripe reports as paid
  // must never be failed, regardless of what the event claims.
  const references = extractSessionReferences(event);
  const sessionId = references.sessionId;

  let paymentStatus: string | null | undefined;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    paymentStatus = session.payment_status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Failed to retrieve Checkout Session "${sessionId}": ${message}`);
  }

  if (paymentStatus === 'paid') {
    console.warn(
      '[stripe-webhook] async_payment_failed ignored - session is authoritatively paid',
      JSON.stringify({ eventId: event.id ?? 'unknown', sessionId })
    );

    return 'already_paid';
  }

  if (!references.bidId) {
    console.warn(
      '[stripe-webhook] async_payment_failed without bid reference - nothing to fail',
      JSON.stringify({ eventId: event.id ?? 'unknown', sessionId })
    );

    return 'unverified';
  }

  return failVerifiedBid(event.id ?? 'unknown', event.type!, references.bidId, sessionId);
}

async function handleChargeRefunded(
  event: StripeLikeEvent
): Promise<ConversionOutcome | 'unverified'> {
  // Task 4.11: authoritative verification - retrieve the charge and require
  // refunded = true (full refund). Partial refunds are acknowledged without mutation:
  // the plan specifies no partial-refund policy, so none is invented.
  const charge = event.data?.object ?? {};
  const chargeId = typeof charge.id === 'string' ? charge.id : 'unknown';
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;

  if (!paymentIntentId) {
    console.warn(
      '[stripe-webhook] charge.refunded without payment_intent - cannot link bid',
      JSON.stringify({ eventId: event.id ?? 'unknown', chargeId })
    );

    return 'unverified';
  }

  let refunded: boolean | null = null;

  try {
    const retrieved = await stripe.charges.retrieve(chargeId);

    refunded = retrieved.refunded;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Failed to retrieve Charge "${chargeId}": ${message}`);
  }

  if (refunded !== true) {
    console.warn(
      '[stripe-webhook] charge.refunded not fully refunded - no state change',
      JSON.stringify({ eventId: event.id ?? 'unknown', chargeId })
    );

    return 'unverified';
  }

  return refundVerifiedBid(event.id ?? 'unknown', event.type!, paymentIntentId);
}

/**
 * Deliver (or retry) the outbid notification for a converted bid (Tasks 6.4 + 6.7).
 *
 * - Invoked for 'converted' AND for 'already_paid'/'duplicate' completions: the ledger
 *   keeps conversion exactly-once (redelivered events answer 'duplicate' before
 *   touching bids), while the per-bid delivery record inside sendOutbidNotification
 *   decides whether the EMAIL may be attempted again. Payment idempotency and
 *   notification-attempt idempotency are independent domains.
 * - Returns the orchestration result; transport-unconfirmed failures carry
 *   retryable=true so the completed-event handler can answer 500 and let Stripe's own
 *   retry schedule redeliver the event - the only "scheduler" this architecture uses.
 * - Provider-rejected failures are terminal (the request was definitively not sent) and
 *   unexpected infrastructure errors stay best-effort: both log and return normally so
 *   Stripe never retries pointlessly. No failure is ever reported as a successful send.
 */
async function deliverOutbidNotification(
  sessionId: string
): Promise<OutbidNotificationResult | null> {
  let result: OutbidNotificationResult;

  try {
    result = await sendOutbidNotification(sessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.warn(
      '[stripe-webhook] outbid notification failed unexpectedly (best-effort; payment already confirmed)',
      JSON.stringify({ sessionId, error: message })
    );

    return null;
  }

  if (!result.notified && result.reason === 'send_failed' && !result.retryable) {
    console.warn(
      '[stripe-webhook] outbid email permanently rejected by provider - not retrying',
      JSON.stringify({ sessionId, attempts: result.attempts })
    );

    return result;
  }

  if (!result.notified) {
    console.info(
      '[stripe-webhook] outbid notification skipped',
      JSON.stringify({ sessionId, reason: result.reason })
    );
  }

  return result;
}

/**
 * Full response resolution for checkout.session.completed events (Tasks 4.5-4.9,
 * extended by Task 6.7).
 */
async function handleCheckoutSessionCompleted(
  event: StripeLikeEvent
): Promise<WebhookProcessingResult> {
  // Task 4.7: the event body only identifies WHICH session to inspect - authoritative
  // payment state comes from Stripe's server-side API via verifyCheckoutSessionPaid.
  const references = extractSessionReferences(event);
  const verification = await verifyCheckoutSessionPaid(references.sessionId);

  if (!verification.verified) {
    console.warn(
      `[stripe-webhook] checkout.session.completed NOT verified (${verification.reason})`,
      JSON.stringify({
        eventId: event.id ?? 'unknown',
        sessionId: verification.sessionId,
        clientReferenceId: references.clientReferenceId,
      })
    );

    // Unverified-but-valid events are legitimate states, not endpoint failures: no
    // conversion path is taken and nothing is claimed in the ledger.
    return { status: 200, body: { received: 'true' } };
  }

  // Tasks 4.8+4.9: claim the event in the ledger and apply the verified conversion in
  // one atomic database transaction.
  const outcome = await processVerifiedEvent(
    event.id ?? 'unknown',
    event.type!,
    verification.bidReference,
    verification.sessionId,
    verification.paymentIntentId
  );

  // Anomalies (missing row, non-pending state, session mismatch) are loud failures so
  // Stripe retries and monitoring surfaces them.
  if (
    outcome === 'bid_not_found' ||
    outcome === 'invalid_state' ||
    outcome === 'session_mismatch'
  ) {
    throw new Error(`Bid conversion failed with outcome "${outcome}"`);
  }

  // Task 6.7: dispatch on first-time conversion AND on redelivery outcomes - the
  // ledger keeps payment exactly-once while the delivery record gates the email, so
  // redelivered events are the retry vehicle for transport-unconfirmed send failures.
  if (outcome === 'converted' || outcome === 'already_paid' || outcome === 'duplicate') {
    const notification = await deliverOutbidNotification(verification.sessionId);

    if (
      notification !== null &&
      !notification.notified &&
      notification.reason === 'send_failed' &&
      notification.retryable
    ) {
      console.error(
        '[stripe-webhook] outbid email retry pending - answering 500 so Stripe redelivers',
        JSON.stringify({
          eventId: event.id ?? 'unknown',
          sessionId: verification.sessionId,
          attempts: notification.attempts,
        })
      );

      return {
        status: 500,
        body: { error: 'Outbid notification retry scheduled' },
      };
    }
  }

  // Task 4.9: replays are surfaced in the response so monitoring can distinguish
  // first deliveries from duplicates; Stripe treats both as success and stops retrying.
  return outcome === 'duplicate'
    ? { status: 200, body: { received: 'true', duplicate: 'true' } }
    : { status: 200, body: { received: 'true' } };
}

export async function processStripeWebhook(
  payload: string,
  signature: string | null
): Promise<WebhookProcessingResult> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret || !webhookSecret.trim()) {
    return {
      status: 500,
      body: { error: 'Webhook secret is not configured' },
    };
  }

  if (typeof payload !== 'string' || !payload || !signature || !signature.trim()) {
    return {
      status: 400,
      body: { error: 'Missing payload or signature' },
    };
  }

  let event: StripeLikeEvent;

  try {
    // Raw payload goes straight into signature verification - no prior parsing.
    // Tolerance (seconds) pins Stripe's replay window (see constant docs).
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret,
      STRIPE_WEBHOOK_TOLERANCE_SECONDS
    ) as StripeLikeEvent;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`[stripe-webhook] signature verification failed: ${message}`);

    return {
      status: 400,
      body: { error: 'Invalid signature' },
    };
  }

  if (!event.type || !SUPPORTED_EVENT_TYPES.has(event.type)) {
    // Acknowledged but ignored: not one of the plan-required event types.
    return { status: 200, body: { received: 'true', ignored: 'true' } };
  }

  try {
    if (event.type === 'checkout.session.completed') {
      // Task 6.7: completed events resolve their FULL response (including email-retry
      // scheduling) in one place - the ledger keeps conversion exactly-once while the
      // delivery record gates whether the email may be attempted again.
      return await handleCheckoutSessionCompleted(event);
    }

    const outcome =
      event.type === 'charge.refunded'
        ? await handleChargeRefunded(event)
        : await handleAsyncPaymentFailed(event);

    // Anomalies (missing row, non-pending state, session mismatch) are loud failures so
    // Stripe retries and monitoring surfaces them.
    if (
      outcome === 'bid_not_found' ||
      outcome === 'invalid_state' ||
      outcome === 'session_mismatch'
    ) {
      throw new Error(`Bid conversion failed with outcome "${outcome}"`);
    }

    // Task 4.9: replays are surfaced in the response so monitoring can distinguish
    // first deliveries from duplicates; Stripe treats both as success and stops retrying.
    return outcome === 'duplicate'
      ? { status: 200, body: { received: 'true', duplicate: 'true' } }
      : { status: 200, body: { received: 'true' } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`[stripe-webhook] processing failure for ${event.type}: ${message}`);

    return {
      status: 500,
      body: { error: 'Webhook processing failed' },
    };
  }
}
