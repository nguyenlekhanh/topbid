import { getBidByStripeSessionId, getPreviousHighestBidder } from '@/lib/bids';
import { buildOutbidEmail } from '@/lib/outbid-email-template';
import { sendEmail } from '@/lib/resend';

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
 * Deliberately out of scope (later tasks own them): the bid-again CTA/link (Task 6.5),
 * unsubscribe handling (Task 6.6), and retry/failure-policy flows beyond propagating
 * provider errors (Task 6.7). No queues, retries, scheduling, or notification state are
 * introduced.
 */

export type OutbidNotificationSkippedReason =
  'new_bid_not_found' | 'no_previous_bidder' | 'self_outbid';

export type OutbidNotificationResult =
  | { notified: true; recipient: string; messageId: string }
  | { notified: false; reason: OutbidNotificationSkippedReason };

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
 * - Throws when the email provider fails (propagated verbatim from sendEmail)
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

  const email = buildOutbidEmail({
    to: previous.bidderEmail,
    bidderName: previous.bidderName,
    categoryName: resolved.category.name,
    previousAmount: previous.amount,
    newAmount: newBid.amount,
    newBidderName: newBid.bidder_name,
  });

  const sent = await sendEmail(email);

  return { notified: true, recipient: previous.bidderEmail, messageId: sent.id };
}
