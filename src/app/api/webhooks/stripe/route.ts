import { NextResponse } from 'next/server';

import { processStripeWebhook } from '@/lib/stripe-webhook';

// The Stripe SDK performs signature verification with Node crypto; keep the default
// Node.js runtime explicit for clarity.
export const runtime = 'nodejs';

/**
 * Stripe webhook endpoint (Task 4.5).
 * - Reads the RAW request body (request.text()) - it is never parsed or re-serialized
 *   before signature verification inside processStripeWebhook
 * - Responds 200 for verified events (handled or intentionally ignored), 400 for
 *   missing/invalid signatures, 500 for configuration/processing failures so Stripe
 *   retries
 */
export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature');

  const result = await processStripeWebhook(payload, signature);

  return NextResponse.json(result.body, { status: result.status });
}
