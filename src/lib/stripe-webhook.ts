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
  'converted' | 'already_paid' | 'bid_not_found' | 'invalid_state' | 'session_mismatch';

const KNOWN_CONVERSION_OUTCOMES: readonly ConversionOutcome[] = [
  'converted',
  'already_paid',
  'bid_not_found',
  'invalid_state',
  'session_mismatch',
];

/**
 * Apply the verified conversion at the database boundary (Task 4.8).
 * - Delegates to the convert_pending_bid_to_paid RPC (row-locked, attach-once session
 *   completion, typed outcomes) - never a check-then-update from application code
 * - RPC errors throw so the endpoint responds 500 and Stripe retries
 */
async function convertVerifiedBid(
  bidId: string,
  sessionId: string,
  paymentIntentId: string | null
): Promise<ConversionOutcome> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc('convert_pending_bid_to_paid', {
    p_bid_id: bidId,
    p_stripe_session_id: sessionId,
    p_stripe_payment_intent_id: paymentIntentId,
  });

  if (error) {
    throw new Error(`Failed to convert bid to paid: ${error.message}`);
  }

  const outcome = data as ConversionOutcome;

  if (!KNOWN_CONVERSION_OUTCOMES.includes(outcome)) {
    throw new Error(`Failed to convert bid to paid: unknown outcome "${String(data)}"`);
  }

  return outcome;
}

/**
 * Replay-protection window for signature timestamps, in seconds.
 * This is Stripe's default tolerance, made explicit so review and tests can pin it;
 * events with older timestamps fail verification.
 */
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

const SUPPORTED_EVENT_TYPES = new Set(['checkout.session.completed']);

type StripeLikeEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: {
      id?: string;
      client_reference_id?: string | null;
      metadata?: Record<string, string> | null;
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

async function handleCheckoutSessionCompleted(event: StripeLikeEvent): Promise<void> {
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

    return;
  }

  // Task 4.8: apply the verified conversion atomically at the database boundary.
  const outcome = await convertVerifiedBid(
    verification.bidReference,
    verification.sessionId,
    verification.paymentIntentId
  );

  if (outcome === 'converted' || outcome === 'already_paid') {
    console.info(
      '[stripe-webhook] checkout.session.completed bid conversion settled',
      JSON.stringify({
        eventId: event.id ?? 'unknown',
        sessionId: verification.sessionId,
        bidReference: verification.bidReference,
        outcome,
      })
    );

    return;
  }

  // Anomalies (missing row, non-pending state, session mismatch) are loud failures so
  // Stripe retries and monitoring surfaces them.
  throw new Error(`Bid conversion failed with outcome "${outcome}"`);
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
    await handleCheckoutSessionCompleted(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`[stripe-webhook] processing failure for ${event.type}: ${message}`);

    return {
      status: 500,
      body: { error: 'Webhook processing failed' },
    };
  }

  return { status: 200, body: { received: 'true' } };
}
