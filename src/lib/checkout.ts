import {
  createPendingBid,
  type Bid,
  type CreatePendingBidFailureReason,
  type PendingBidInput,
} from '@/lib/bids';
import { validateCategory } from '@/lib/categories';
import { createServiceClient } from '@/lib/supabase-service';
import { stripe } from '@/lib/stripe';

/**
 * Single checkout currency for the MVP: the schema carries amounts as integer cents
 * without a per-category currency column, so the app-level constant applies everywhere.
 */
export const CHECKOUT_CURRENCY = 'usd';

export type CheckoutSessionResult =
  | {
      valid: true;
      bid: Bid;
      checkoutSessionId: string;
      stripeSessionId: string;
      url: string;
    }
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
 * - Task sequencing: the session carries client_reference_id = bid id plus metadata
 *   {bid_id, category_id} so webhook handling (Task 4.5+) can resolve the bid without
 *   trusting session data; afterwards the session identifier is persisted onto the bid
 *   row via the attach_stripe_session RPC, whose UPDATE matches only pending bids with
 *   no session yet (attach-once; preserves Task 3.7 duplicate semantics at the DB
 *   boundary). Crash-window note: if the process dies between creation and attachment,
 *   the bid stays pending with NULL session id (documented reservation behavior) while
 *   the session still references it via client_reference_id/metadata
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
      // Task 4.2 linkage: webhook handling (Task 4.5+) resolves the bid from these
      // fields without trusting any session data.
      client_reference_id: bid.id,
      metadata: {
        bid_id: bid.id,
        category_id: bid.category_id,
      },
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
      // Task 4.3: Stripe replaces {CHECKOUT_SESSION_ID} on redirect so the success
      // page can look up the bid authoritatively by session identifier.
      success_url: `${buildAppUrl('/success')}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: buildAppUrl('/cancel'),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Failed to create Stripe Checkout session: ${message}`);
  }

  if (!session.id || !session.url) {
    throw new Error('Failed to create Stripe Checkout session: Stripe returned no session id/url');
  }

  // Task 4.2 linkage: persist the session id onto the bid row (attach-once guard
  // enforced by the RPC at the database boundary).
  const supabase = createServiceClient();

  const { data: attached, error: attachError } = await supabase.rpc('attach_stripe_session', {
    p_bid_id: bid.id,
    p_stripe_session_id: session.id,
  });

  if (attachError) {
    throw new Error(`Failed to link checkout session to bid: ${attachError.message}`);
  }

  if (attached !== true) {
    throw new Error('Failed to link checkout session to bid: bid is no longer eligible');
  }

  return {
    valid: true,
    bid,
    checkoutSessionId: session.id,
    stripeSessionId: session.id,
    url: session.url,
  };
}
