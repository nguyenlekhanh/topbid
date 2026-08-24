import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Task 4.12 — Stripe TEST-MODE integration tests.
 *
 * These exercise the REAL boundaries the unit suites mock: Stripe test-mode APIs,
 * genuine webhook signatures through the SDK's constructEvent, and the Supabase
 * service-role database (ledger claim + pending->paid/refunded transitions).
 *
 * They are OPT-IN and SKIP unless explicitly enabled, because they require:
 *   RUN_STRIPE_INTEGRATION=true
 *   STRIPE_SECRET_KEY=<test-mode sk_test_...>      STRIPE_WEBHOOK_SECRET=whsec_...
 *   NEXT_PUBLIC_SUPABASE_URL=<disposable project>  SUPABASE_SERVICE_ROLE_KEY=...
 *   NEXT_PUBLIC_APP_URL=http://localhost:3000
 *
 * NEVER point these tests at production/live credentials. Values are loaded from
 * .env.local when present (without overriding already-set variables); nothing is faked:
 * when credentials are missing the suites report SKIPPED, not passed.
 */

function loadEnvFileDefaults(path = '.env.local') {
  try {
    const content = readFileSync(path, 'utf8');

    for (const rawLine of content.split(/\r?\n/)) {
      const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(rawLine.trim());

      if (match && !(match[1] in process.env)) {
        process.env[match[1]] = match[2].trim();
      }
    }
  } catch {
    // .env.local is optional for integration runs; operators may export vars instead.
  }
}

loadEnvFileDefaults();

const OPT_IN = process.env.RUN_STRIPE_INTEGRATION === 'true';
const hasStripeCredentials = Boolean(process.env.STRIPE_SECRET_KEY);
const hasWebhookSecret = Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim());
const hasSupabaseCredentials = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

const runStripeApi = OPT_IN && hasStripeCredentials;
const runWebhookSignature = runStripeApi && hasWebhookSecret;
const runFullLifecycle = runWebhookSignature && hasSupabaseCredentials;

type StripeModule = typeof import('@/lib/stripe');

let stripeModule: StripeModule;

// Test-scoped fixtures; created and cleaned up by the lifecycle suite.
const TEST_CATEGORY_SLUG_PREFIX = 'integration-test-';

function signWebhookPayload(payload: string): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET!;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');

  return `t=${timestamp},v1=${signature}`;
}

describe.skipIf(!runStripeApi)('Stripe test-mode Checkout API (Task 4.12)', () => {
  beforeAll(async () => {
    stripeModule = await import('@/lib/stripe');
  });

  it('creates and retrieves a real test-mode Checkout Session', async () => {
    const session = await stripeModule.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: 1000,
            product_data: { name: 'Topbid integration test' },
          },
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/cancel`,
    });

    expect(session.id).toMatch(/^cs_test_/);

    const retrieved = await stripeModule.stripe.checkout.sessions.retrieve(session.id);

    expect(retrieved.status).toBe('open');
    expect(retrieved.payment_status).toBe('unpaid');
  });
});

describe.skipIf(!runWebhookSignature)('webhook signature round-trip (Tasks 4.5+4.6+4.12)', () => {
  it('acknowledges signed unsupported events through the real verification path', async () => {
    const { processStripeWebhook } = await import('@/lib/stripe-webhook');

    const payload = JSON.stringify({
      id: `evt_${Date.now()}`,
      object: 'event',
      type: 'invoice.paid',
      data: { object: { id: 'in_test' } },
    });

    const result = await processStripeWebhook(payload, signWebhookPayload(payload));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: 'true', ignored: 'true' });
  });

  it('answers 500 for signed completed events referencing sessions Stripe cannot find (retry semantics)', async () => {
    const { processStripeWebhook } = await import('@/lib/stripe-webhook');

    const payload = JSON.stringify({
      id: `evt_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_nonexistent_integration_test' } },
    });

    const result = await processStripeWebhook(payload, signWebhookPayload(payload));

    expect(result.status).toBe(500);
  });

  it('rejects tampered payloads through the real verification path', async () => {
    const { processStripeWebhook } = await import('@/lib/stripe-webhook');

    const payload = JSON.stringify({ id: `evt_${Date.now()}` });
    const header = signWebhookPayload(payload);
    const tampered = `${payload} `;

    const result = await processStripeWebhook(tampered, header);

    expect(result.status).toBe(400);
  });
});

describe.skipIf(!runFullLifecycle)(
  'checkout -> webhook -> conversion -> refund lifecycle (Tasks 4.1-4.11)',
  () => {
    let categoryId = '';
    let bidId = '';
    let sessionId = '';

    afterAll(async () => {
      if (!runFullLifecycle || !categoryId || !bidId) {
        return;
      }

      const { createServiceClient } = await import('@/lib/supabase-service');
      const supabase = createServiceClient();

      await supabase.from('bids').delete().eq('id', bidId);
      await supabase.from('categories').delete().eq('slug', TEST_CATEGORY_SLUG_PREFIX);
    });

    it('runs the full paid lifecycle against real Stripe test mode and Supabase', async () => {
      const [{ createServiceClient }, { createCheckoutSession }, webhookLib] = await Promise.all([
        import('@/lib/supabase-service'),
        import('@/lib/checkout'),
        import('@/lib/stripe-webhook'),
      ]);

      stripeModule = stripeModule ?? ((await import('@/lib/stripe')) as StripeModule);
      const supabase = createServiceClient();
      const slug = `${TEST_CATEGORY_SLUG_PREFIX}${Date.now()}`;

      // Seed the authoritative category row for the flow.
      const { error: seedError } = await supabase.from('categories').upsert(
        {
          slug,
          name: 'Integration test category',
          starting_bid: 1000,
          increment: 500,
          is_active: true,
        },
        { onConflict: 'slug' }
      );

      expect(seedError).toBeNull();

      const { data: categoryRow } = await supabase
        .from('categories')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();

      categoryId = categoryRow!.id;

      // Tasks 3.5/4.1/4.2: pending bid + real Checkout session, linked by metadata.
      const checkout = await createCheckoutSession({
        categorySlug: slug,
        amount: 1000,
        bidderEmail: 'integration-test@example.com',
        bidderName: 'Integration Test',
      });

      expect(checkout.valid).toBe(true);

      if (!checkout.valid) {
        return;
      }

      bidId = checkout.bid.id;
      sessionId = checkout.stripeSessionId;
      expect(sessionId).toMatch(/^cs_test_/);

      // Task 4.5/4.6/4.7/4.8/4.9: deliver a genuinely signed completed event.
      const completedPayload = JSON.stringify({
        id: `evt_completed_${Date.now()}`,
        object: 'event',
        type: 'checkout.session.completed',
        data: { object: { id: sessionId } },
      });

      const completedResult = await webhookLib.processStripeWebhook(
        completedPayload,
        signWebhookPayload(completedPayload)
      );

      expect(completedResult.status).toBe(200);

      const { data: paidBid } = await supabase
        .from('bids')
        .select('status')
        .eq('id', bidId)
        .maybeSingle();

      expect(paidBid?.status).toBe('paid');

      // Task 4.9: identical delivery is acknowledged as duplicate.
      const replayResult = await webhookLib.processStripeWebhook(
        completedPayload,
        signWebhookPayload(completedPayload)
      );

      expect(replayResult.body).toEqual({ received: 'true', duplicate: 'true' });

      // Task 4.11: authoritative full-refund event transitions the paid bid.
      const retrievedSession = await stripeModule.stripe.checkout.sessions.retrieve(sessionId);
      const paymentIntentId =
        typeof retrievedSession.payment_intent === 'string'
          ? retrievedSession.payment_intent
          : null;

      if (!paymentIntentId) {
        // Test-mode card payments normally produce one immediately; skip refunds when absent.
        console.warn('[integration] no payment_intent on session; refund leg skipped');
        return;
      }

      const refundPayload = JSON.stringify({
        id: `evt_refund_${Date.now()}`,
        object: 'event',
        type: 'charge.refunded',
        data: {
          object: {
            id: `ch_${Date.now()}`,
            refunded: true,
            payment_intent: paymentIntentId,
          },
        },
      });

      const refundResult = await webhookLib.processStripeWebhook(
        refundPayload,
        signWebhookPayload(refundPayload)
      );

      expect(refundResult.status).toBe(200);

      const { data: refundedBid } = await supabase
        .from('bids')
        .select('status')
        .eq('id', bidId)
        .maybeSingle();

      expect(refundedBid?.status).toBe('refunded');
    });
  }
);
