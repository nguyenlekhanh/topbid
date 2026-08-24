import { createHmac } from 'node:crypto';

import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Task 4.6 — REAL signature-verification tests.
 *
 * Unlike src/lib/stripe-webhook.test.ts (which mocks the Stripe boundary), this file
 * uses the genuine Stripe SDK constructEvent implementation to prove the properties
 * that matter for a security boundary:
 * - the exact raw payload is what gets verified (tampered bytes fail)
 * - valid signatures succeed within Stripe's replay window
 * - stale timestamps / wrong secrets / missing headers fail
 *
 * No network and no live Stripe are involved; signatures are computed locally with
 * HMAC-SHA256 following Stripe's documented scheme (t=timestamp,v1=HMAC(secret,
 * "timestamp.payload")).
 */

const SECRET = 'whsec_real_signature_tests';

let processStripeWebhook: typeof import('./stripe-webhook').processStripeWebhook;
let STRIPE_WEBHOOK_TOLERANCE_SECONDS: number;

beforeAll(async () => {
  // The stripe client is constructed at module import time and requires a key even
  // when only constructEvent is used; provide a server-side placeholder value.
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_placeholder_for_module_import');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);

  const webhookLib = await import('./stripe-webhook');
  processStripeWebhook = webhookLib.processStripeWebhook;
  STRIPE_WEBHOOK_TOLERANCE_SECONDS = webhookLib.STRIPE_WEBHOOK_TOLERANCE_SECONDS;

  // constructEvent above runs GENUINELY (real signature crypto), while the outbound
  // Checkout Session retrieval introduced by Task 4.7 is a network boundary - mocked
  // here so signature properties stay isolated from API availability.
  const { stripe } = await import('@/lib/stripe');
  vi.spyOn(stripe.checkout.sessions, 'retrieve').mockResolvedValue({
    id: 'cs_real_1',
    payment_status: 'paid',
    client_reference_id: 'bid-1000',
    metadata: { bid_id: 'bid-1000' },
  } as never);
});

function signPayload(payload: string, timestampSeconds: number, secret: string = SECRET): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestampSeconds}.${payload}`)
    .digest('hex');

  return `t=${timestampSeconds},v1=${signature}`;
}

function currentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

const VALID_PAYLOAD = JSON.stringify({
  id: 'evt_real_1',
  object: 'event',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_real_1',
      client_reference_id: 'bid-1000',
      metadata: { bid_id: 'bid-1000' },
    },
  },
});

const TAMPERED_PAYLOAD = JSON.stringify({
  id: 'evt_real_1',
  object: 'event',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_real_1',
      // attacker-modified amount metadata would live here
      client_reference_id: 'bid-9999',
      metadata: { bid_id: 'bid-9999', amount: '1' },
    },
  },
});

describe('processStripeWebhook signature verification (real Stripe crypto)', () => {
  it('accepts a correctly signed payload delivered within the replay window', async () => {
    const header = signPayload(VALID_PAYLOAD, currentTimestamp());

    const result = await processStripeWebhook(VALID_PAYLOAD, header);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true' });
  });

  it('rejects a tampered payload whose signature was computed over different bytes', async () => {
    const header = signPayload(VALID_PAYLOAD, currentTimestamp());

    const result = await processStripeWebhook(TAMPERED_PAYLOAD, header);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Invalid signature' });
  });

  it('rejects payloads signed with the wrong secret', async () => {
    const header = signPayload(VALID_PAYLOAD, currentTimestamp(), 'whsec_attacker_knows');

    const result = await processStripeWebhook(VALID_PAYLOAD, header);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Invalid signature' });
  });

  it('returns 400 when the signature header is missing entirely', async () => {
    const result = await processStripeWebhook(VALID_PAYLOAD, null);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Missing payload or signature' });
  });

  it('enforces the explicit replay-window tolerance on stale timestamps', async () => {
    const staleTimestamp = currentTimestamp() - (STRIPE_WEBHOOK_TOLERANCE_SECONDS + 60);
    const header = signPayload(VALID_PAYLOAD, staleTimestamp);

    const result = await processStripeWebhook(VALID_PAYLOAD, header);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Invalid signature' });
  });

  it('still accepts timestamps inside the tolerance window', async () => {
    const recentTimestamp = currentTimestamp() - (STRIPE_WEBHOOK_TOLERANCE_SECONDS - 30);
    const header = signPayload(VALID_PAYLOAD, recentTimestamp);

    const result = await processStripeWebhook(VALID_PAYLOAD, header);

    expect(result.status).toBe(200);
  });

  it('rejects signed non-JSON payloads (raw body integrity handling)', async () => {
    const notJson = 'this is not json but was signed';
    const header = signPayload(notJson, currentTimestamp());

    const result = await processStripeWebhook(notJson, header);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Invalid signature' });
  });

  it('acknowledges unsupported-but-validly-signed event types as ignored', async () => {
    const otherEventPayload = JSON.stringify({
      id: 'evt_real_2',
      object: 'event',
      type: 'invoice.paid',
      data: { object: { id: 'in_real_1' } },
    });
    const header = signPayload(otherEventPayload, currentTimestamp());

    const result = await processStripeWebhook(otherEventPayload, header);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true', ignored: 'true' });
  });
});
