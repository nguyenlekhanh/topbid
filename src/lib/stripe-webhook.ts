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

function handleCheckoutSessionCompleted(event: StripeLikeEvent): void {
  // Task 4.5 boundary: acknowledge and record the linkage only. Converting the bid to
  // 'paid' belongs to Task 4.8; no bid rows are read or written here.
  const references = extractSessionReferences(event);

  console.info(
    `[stripe-webhook] checkout.session.completed received`,
    JSON.stringify({
      eventId: event.id ?? 'unknown',
      sessionId: references.sessionId,
      clientReferenceId: references.clientReferenceId,
      bidId: references.bidId,
    })
  );
}

export function processStripeWebhook(
  payload: string,
  signature: string | null
): WebhookProcessingResult {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return {
      status: 500,
      body: { error: 'Webhook secret is not configured' },
    };
  }

  if (typeof payload !== 'string' || !payload || !signature) {
    return {
      status: 400,
      body: { error: 'Missing payload or signature' },
    };
  }

  let event: StripeLikeEvent;

  try {
    // Raw payload goes straight into signature verification - no prior parsing.
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret) as StripeLikeEvent;
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
    handleCheckoutSessionCompleted(event);
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
