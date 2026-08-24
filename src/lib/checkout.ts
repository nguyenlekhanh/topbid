import {
  createPendingBid,
  type Bid,
  type CreatePendingBidFailureReason,
  type PendingBidInput,
} from '@/lib/bids';
import { validateCategory } from '@/lib/categories';
import { stripe } from '@/lib/stripe';

/**
 * Single checkout currency for the MVP: the schema carries amounts as integer cents
 * without a per-category currency column, so the app-level constant applies everywhere.
 */
export const CHECKOUT_CURRENCY = 'usd';

export type CheckoutSessionResult =
  | { valid: true; bid: Bid; checkoutSessionId: string; url: string }
  | { valid: false; reason: CreatePendingBidFailureReason; minimumBid: number | null };

function buildAppUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;

  if (!base) {
    throw new Error('Missing NEXT_PUBLIC_APP_URL: required to build Stripe success/cancel URLs');
  }

  return `${base.replace(/\/+$/, '')}${path}`;
}

/**
 * Create a Stripe Checkout session for a newly validated pending bid.
 *
 * - Server-side only: uses STRIPE_SECRET_KEY via the Task 0.6 stripe client; the secret
 *   key is never exposed to the client
 * - Reuses the Task 3.5 contract verbatim: the bid is created first through
 *   createPendingBid (authoritative validation, explicit status='pending'), and its
 *   validated integer-cent amount becomes the checkout line-item unit amount - client
 *   data is never trusted for pricing
 * - Task sequencing: the session identifier/metadata link between bid and checkout
 *   session is deliberately NOT set here (that is Task 4.2 - Attach category/bid
 *   metadata); the pending bid stores a NULL stripe_session_id, which the UNIQUE
 *   constraint treats as distinct (Task 3.7)
 * - Success/cancel URLs are derived from the trusted NEXT_PUBLIC_APP_URL env with
 *   placeholder paths until Tasks 4.3/4.4 introduce the real pages; accepting caller-
 *   supplied URLs was rejected to avoid open-redirect surface
 * - Contract: expected failures mirror the Task 3.5 union exactly (reason + minimumBid);
 *   unexpected failures (Stripe API errors, missing env config) throw descriptive Errors
 */
export async function createCheckoutSession(
  input: PendingBidInput
): Promise<CheckoutSessionResult> {
  const pending = await createPendingBid(input);

  if (!pending.valid) {
    return { valid: false, reason: pending.reason, minimumBid: pending.minimumBid };
  }

  const bid = pending.bid;

  // Display name for the line item comes from the authoritative DB row. This cannot
  // realistically fail right after createPendingBid validated the same slug; treated
  // as an invariant violation if it ever does.
  const categoryValidation = await validateCategory(input.categorySlug);

  if (!categoryValidation.valid) {
    throw new Error(
      'Failed to create Stripe Checkout session: category became unavailable after bid validation'
    );
  }

  let session;

  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CHECKOUT_CURRENCY,
            unit_amount: bid.amount,
            product_data: {
              name: categoryValidation.category.name,
            },
          },
        },
      ],
      success_url: buildAppUrl('/success'),
      cancel_url: buildAppUrl('/cancel'),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Failed to create Stripe Checkout session: ${message}`);
  }

  if (!session.id || !session.url) {
    throw new Error('Failed to create Stripe Checkout session: Stripe returned no session id/url');
  }

  return {
    valid: true,
    bid,
    checkoutSessionId: session.id,
    url: session.url,
  };
}
