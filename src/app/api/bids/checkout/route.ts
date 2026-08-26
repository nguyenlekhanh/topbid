import { NextResponse } from 'next/server';

import { createCheckoutSession } from '@/lib/checkout';
import { resolveNextBid } from '@/lib/next-bid';
import { normalizeProductInput, syntheticBidderEmail } from '@/lib/product-input';
import { resolveProductPreview } from '@/lib/product-resolver';
import { getClientIp, RATE_LIMIT_RULES, rateLimiters } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * Public checkout entry for the console bidding UX.
 *
 * Contract: the client sends ONLY { product, categorySlug? } - NEVER an amount. The
 * server derives the authoritative amount from database state (resolveNextBid), then
 * reuses the EXISTING Task 4.1 checkout flow (createCheckoutSession -> createPendingBid
 * RPC -> Stripe Checkout), where the RPC re-validates the amount inside its row lock.
 * There is deliberately no code path by which a client-supplied price can reach Stripe.
 *
 * `product` is the user-supplied public display value (https URL or @handle). It is
 * normalized/validated server-side (product-input.ts), stored in bids.bidder_name
 * (the existing public display column) and attached to Stripe metadata; its synthetic
 * deterministic address satisfies the NOT NULL bidder_email column without collecting
 * any personal email.
 *
 * Error mapping (stable, generic):
 *   400 invalid_product / invalid_product_input / category_not_found /
 *      amount_below_minimum (+ minimumBid echo)
 *   409 duplicate_transaction
 *   429 rate limited (Retry-After)
 *   500 unexpected failures (generic body; details stay in server logs)
 */
export async function POST(request: Request) {
  if (!rateLimiters.bidCheckout.check(getClientIp(request), RATE_LIMIT_RULES.bidCheckout).allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_product_input' }, { status: 400 });
  }

  const body =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  // NOTE: any client-provided "amount" field is intentionally IGNORED - the server
  // derives the authoritative amount below.
  const categorySlug = typeof body.categorySlug === 'string' ? body.categorySlug : undefined;

  const product = normalizeProductInput(body.product);

  if (!product.ok) {
    return NextResponse.json({ error: 'invalid_product' }, { status: 400 });
  }

  // Preserve original trimmed input for bare-domain fallback display
  const originalInput = typeof body.product === 'string' ? body.product.trim() : '';

  let derived;

  try {
    derived = await resolveNextBid({ categorySlug });
  } catch {
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  if (!derived.ok) {
    return NextResponse.json(
      { error: derived.reason },
      { status: derived.reason === 'category_not_found' ? 400 : 503 }
    );
  }

  // Prepare entry metadata for persistence
  let entryTitle: string | null = null;
  let entryDescription: string | null = null;
  let entryCanonicalUrl: string | null = null;
  let entryImageUrl: string | null = null;
  let entryFaviconUrl: string | null = null;
  let entryType: 'url' | 'handle' | 'unknown' | null = null;

  if (product.kind === 'url') {
    // Try to resolve metadata for real URLs
    const preview = await resolveProductPreview(product.value);
    if (preview.ok) {
      entryTitle = preview.preview.title;
      entryDescription = preview.preview.description;
      entryCanonicalUrl = preview.preview.canonicalUrl;
      entryImageUrl = preview.preview.imageUrl;
      entryFaviconUrl = preview.preview.faviconUrl;
      entryType = 'url';
    } else {
      // Metadata resolution failed - fall back safely
      // For bare domains, use original input (no https:// prefix) as title
      entryTitle = product.isBareDomain ? originalInput : product.value;
      entryDescription = 'Verified public entry.';
      entryType = 'unknown';
    }
  } else if (product.kind === 'handle') {
    // @handle - no external search, generic public entry
    entryTitle = product.value;
    entryDescription = 'Verified public entry.';
    entryType = 'handle';
  }

  try {
    const session = await createCheckoutSession({
      categorySlug: derived.categorySlug,
      amount: derived.amount,
      bidderEmail: syntheticBidderEmail(product.value),
      bidderName: product.value,
      entryTitle,
      entryDescription,
      entryCanonicalUrl,
      entryImageUrl,
      entryFaviconUrl,
      entryType,
    });

    if (!session.valid) {
      const status = session.reason === 'duplicate_transaction' ? 409 : 400;

      return NextResponse.json(
        { error: session.reason, minimumBid: session.minimumBid },
        { status }
      );
    }

    return NextResponse.json({ url: session.url, sessionId: session.stripeSessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error('[bid-checkout] checkout session creation failed:', message);

    return NextResponse.json({ error: 'checkout_failed' }, { status: 500 });
  }
}
