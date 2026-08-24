import { getBidByStripeSessionId, getPreviousHighestBidder } from '@/lib/bids';
import {
  beginDeliveryAttempt,
  markDeliveryFailed,
  markDeliverySent,
} from '@/lib/notification-deliveries';
import { buildOutbidEmail } from '@/lib/outbid-email-template';
import { sendEmail, SendEmailError } from '@/lib/resend';
import { buildUnsubscribeUrl, isUnsubscribed, listUnsubscribeHeaders } from '@/lib/unsubscribe';

/**
 * Outbid notification orchestration (Task 6.4).
 *
 * Composes the established Phase 6 building blocks into one server-side flow:
 * 1. Resolve the newly PAID bid authoritatively via getBidByStripeSessionId (Task 4.3).
 *    After the verified webhook conversion commits, the bid row is status='paid' and
 *    therefore visible under RLS - a null/unreadable resolution means there is nothing
 *    trustworthy to notify about, so the flow skips instead of guessing.
 * 2. Detect the previous highest bidder via getPreviousHighestBidder (Task 6.1),
 *    excluding the new bid - derived from authoritative paid-bid history.
 * 3. Compose subject/HTML/text with buildOutbidEmail (Task 6.3) - pure, escaped,
 *    deterministic.
 * 4. Deliver through sendEmail (Task 6.2) - the ONLY provider boundary. Provider
 *    failures propagate as thrown errors so callers never mistake a failed send for a
 *    delivered one.
 *
 * Server-only module: transitively imports Resend credentials and must never be
 * imported by client code.
 *
 * Failure handling (Task 6.7): every send attempt is gated and recorded through
 * notification-deliveries state keyed by bid id - 'sent' deliveries are NEVER resent,
 * transport-unconfirmed failures are retried when Stripe redelivers the event, and
 * provider-rejected requests are terminal. Payment idempotency (the webhook ledger)
 * and notification-attempt idempotency (this table) are independent domains: a
 * redelivered event answers 'duplicate' before touching bids while the delivery row
 * alone decides whether the email may be attempted again.
 */

export type OutbidNotificationSkippedReason =
  | 'new_bid_not_found'
  | 'no_previous_bidder'
  | 'self_outbid'
  | 'recipient_unsubscribed'
  | 'already_sent'
  | 'already_handled';

export type OutbidNotificationResult =
  | { notified: true; recipient: string; messageId: string }
  | { notified: false; reason: OutbidNotificationSkippedReason }
  | {
      notified: false;
      reason: 'send_failed';
      /** Transport-unconfirmed failures stay retryable via Stripe redelivery. */
      retryable: boolean;
      attempts: number;
    };

/**
 * Build the absolute bid-again destination for the email CTA (Task 6.5).
 *
 * - Uses the existing NEXT_PUBLIC_APP_URL base (the same trusted configuration the
 *   Checkout success/cancel URLs are built from) with the established homepage section
 *   anchor convention (`/#categories-heading`, mirroring /#leaderboard-heading) - no
 *   per-category public route exists yet, so the categories grid is the correct
 *   existing bidding destination; a route is never invented here
 * - Client-provided URLs can never reach this code path: the value is derived solely
 *   from server environment configuration plus a constant fragment
 * - A missing base URL throws descriptively (consistent with checkout URL building)
 *   rather than silently sending an email whose primary action is broken
 */
function buildBidAgainUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;

  if (!base || !base.trim()) {
    throw new Error('Missing NEXT_PUBLIC_APP_URL: required to build the bid-again link');
  }

  return `${base.trim().replace(/\/+$/, '')}/#categories-heading`;
}

/**
 * Send the outbid notification for a newly paid bid identified by its Checkout Session
 * id (the identifier the verified webhook already holds).
 *
 * - Returns who was notified plus the provider message id on success
 * - Skips (typed reason, no email attempted) when:
 *   - the session id is blank or no paid bid is visible for it ('new_bid_not_found' -
 *     includes the very-first-delivery race where the caller invoked before commit)
 *   - the outbidding bid was the first paid bid in its category ('no_previous_bidder')
 *   - the previous top bidder is the same person who just became highest again
 *     ('self_outbid', case-insensitive email comparison - bidders outbidding themselves
 *     must never be told they were outbid)
 *   - the previous top bidder has unsubscribed from outbid notifications
 *     ('recipient_unsubscribed', Task 6.6 - checked authoritatively before composition,
 *     on EVERY attempt including retries)
 *   - a delivery for this bid was already recorded as sent ('already_sent' - the core
 *     Task 6.7 guarantee that redelivered events can never duplicate an email) or as
 *     terminally failed/abandoned ('already_handled')
 * - Returns {reason:'send_failed', retryable, attempts} when the provider send fails:
 *   transport-unconfirmed failures are retryable (Stripe redelivery re-enters this
 *   flow); provider rejections are terminal. The failure is persisted before returning
 * - Throws only on unexpected infrastructure errors (e.g. delivery-state database
 *   failures), never mistaking them for successful sends
 */
export async function sendOutbidNotification(
  stripeSessionId: string
): Promise<OutbidNotificationResult> {
  if (typeof stripeSessionId !== 'string' || !stripeSessionId.trim()) {
    return { notified: false, reason: 'new_bid_not_found' };
  }

  const resolved = await getBidByStripeSessionId(stripeSessionId);

  // Defensive: the category FK cannot dangle (ON DELETE CASCADE), so an unreadable
  // category simply means the authoritative context could not be resolved - skip
  // rather than invent placeholder content.
  if (!resolved || !resolved.category?.name) {
    return { notified: false, reason: 'new_bid_not_found' };
  }

  const newBid = resolved.bid;

  const previous = await getPreviousHighestBidder(newBid.category_id, newBid.id);

  if (!previous) {
    return { notified: false, reason: 'no_previous_bidder' };
  }

  const recipientKey = previous.bidderEmail.trim().toLowerCase();
  const newBidderKey = newBid.bidder_email.trim().toLowerCase();

  if (recipientKey === newBidderKey) {
    return { notified: false, reason: 'self_outbid' };
  }

  // Task 6.6: server-side suppression BEFORE composing/sending - an unsubscribed
  // recipient must never receive future outbid notifications through this flow.
  // Checked after the self-notification guard so a self-outbid skip is reported
  // as such regardless of suppression state.
  if (await isUnsubscribed(previous.bidderEmail)) {
    return { notified: false, reason: 'recipient_unsubscribed' };
  }

  // Task 6.7: gate and record the attempt BEFORE composing - a recorded 'sent' or
  // terminally failed delivery must never send again, no matter how often the
  // triggering webhook event is redelivered.
  const attempt = await beginDeliveryAttempt(newBid.id);

  if (attempt.status === 'sent') {
    return { notified: false, reason: 'already_sent' };
  }

  if (attempt.status === 'failed_permanent') {
    return { notified: false, reason: 'already_handled' };
  }

  // Captured before the send: control-flow narrowing does not survive into catch.
  const attemptNumber = attempt.attempts;

  const unsubscribeUrl = buildUnsubscribeUrl(previous.bidderEmail);

  if (!unsubscribeUrl) {
    throw new Error('Failed to build unsubscribe link: unidentifiable recipient email');
  }

  const email = buildOutbidEmail({
    to: previous.bidderEmail,
    bidderName: previous.bidderName,
    categoryName: resolved.category.name,
    previousAmount: previous.amount,
    newAmount: newBid.amount,
    newBidderName: newBid.bidder_name,
    bidAgainUrl: buildBidAgainUrl(),
    unsubscribeUrl,
  });

  // Task 6.6: advertise one-click unsubscription at the transport level. Headers are
  // transport metadata, so they are attached here - never inside the pure template.
  try {
    const sent = await sendEmail({
      ...email,
      headers: listUnsubscribeHeaders(unsubscribeUrl),
    });

    await markDeliverySent(newBid.id, sent.id);

    return { notified: true, recipient: previous.bidderEmail, messageId: sent.id };
  } catch (error) {
    // Task 6.7: classify the two real provider failure modes and persist the outcome.
    // Only SendEmailError is a classified send failure; anything else is an unexpected
    // infrastructure error that must never be reported as a handled send result.
    if (!(error instanceof SendEmailError)) {
      throw error;
    }

    const retryable = error.kind === 'send_unconfirmed';

    await markDeliveryFailed(
      newBid.id,
      retryable ? 'failed_retryable' : 'failed_permanent',
      error.message
    );

    return { notified: false, reason: 'send_failed', retryable, attempts: attemptNumber };
  }
}
