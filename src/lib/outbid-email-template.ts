/**
 * Outbid notification email template (Task 6.3).
 *
 * Pure and side-effect free: builds the subject/HTML/text for an outbid notification
 * from authoritative input. No provider imports, no network calls - Task 6.4 will pass
 * the result to sendEmail() (Task 6.2), and Task 6.5 will add the bid-again link.
 *
 * All dynamic values are HTML-escaped for the HTML body; the text body receives them raw.
 */

export type OutbidEmailTemplateInput = {
  /** Recipient address of the previously highest bidder. */
  to: string;
  /** Display name of the outbid bidder; null falls back to a generic greeting. */
  bidderName: string | null;
  /** Authoritative category name the bid was placed on. */
  categoryName: string;
  /** The outbid bidder's own amount, in cents. */
  previousAmount: number;
  /** The new top amount that outbid them, in cents. */
  newAmount: number;
  /** Display name of the bidder who took the top spot; null falls back generically. */
  newBidderName: string | null;
};

export type OutbidEmailContent = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function buildOutbidEmail(input: OutbidEmailTemplateInput): OutbidEmailContent {
  const recipientName = input.bidderName?.trim() || 'there';
  const categoryName = input.categoryName.trim();
  const newBidderLabel = input.newBidderName?.trim() || 'Another bidder';

  const previousFormatted = formatCurrency(input.previousAmount);
  const newFormatted = formatCurrency(input.newAmount);

  const subject = `You've been outbid on ${categoryName}!`;

  const safeRecipientName = escapeHtml(recipientName);
  const safeCategoryName = escapeHtml(categoryName);
  const safeNewBidderLabel = escapeHtml(newBidderLabel);
  const safePreviousFormatted = escapeHtml(previousFormatted);
  const safeNewFormatted = escapeHtml(newFormatted);

  const html = [
    `<p>Hi ${safeRecipientName},</p>`,
    `<p>Someone has outbid you on <strong>${safeCategoryName}</strong> on Topbid.</p>`,
    `<p>Your bid of <strong>${safePreviousFormatted}</strong> has been surpassed by <strong>${safeNewBidderLabel}</strong> with a new top bid of <strong>${safeNewFormatted}</strong>.</p>`,
    `<p>Place a higher bid to reclaim the top spot!</p>`,
  ].join('\n');

  const text = [
    `Hi ${recipientName},`,
    '',
    `Someone has outbid you on ${categoryName} on Topbid.`,
    '',
    `Your bid of ${previousFormatted} has been surpassed by ${newBidderLabel} with a new top bid of ${newFormatted}.`,
    '',
    'Place a higher bid to reclaim the top spot!',
  ].join('\n');

  return {
    to: input.to,
    subject,
    html,
    text,
  };
}
