/**
 * Outbid notification email template (Task 6.3, extended by Task 6.5).
 *
 * Pure and side-effect free: builds the subject/HTML/text for an outbid notification
 * from authoritative input. No provider imports, no network calls - Task 6.4 passes
 * the result to sendEmail() (Task 6.2).
 *
 * All dynamic values are HTML-escaped for the HTML body; the text body receives them raw.
 * When bidAgainUrl is provided (Task 6.5), a plain bid-again CTA pointing at that exact
 * URL is appended; the URL is escaped for attribute context but never altered,
 * rewritten, or validated here - callers own constructing it from trusted configuration.
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
  /**
   * Absolute URL of the public bidding destination for the bid-again CTA (Task 6.5).
   * Optional: omitted keeps the email identical to the pre-6.5 template (no link).
   */
  bidAgainUrl?: string;
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

  // Task 6.5: optional bid-again CTA. The URL is caller-constructed from trusted
  // configuration; it is only HTML-escaped here for attribute context.
  const bidAgainUrl = input.bidAgainUrl?.trim() || null;
  const safeBidAgainUrl = bidAgainUrl ? escapeHtml(bidAgainUrl) : null;

  const htmlParts = [
    `<p>Hi ${safeRecipientName},</p>`,
    `<p>Someone has outbid you on <strong>${safeCategoryName}</strong> on Topbid.</p>`,
    `<p>Your bid of <strong>${safePreviousFormatted}</strong> has been surpassed by <strong>${safeNewBidderLabel}</strong> with a new top bid of <strong>${safeNewFormatted}</strong>.</p>`,
    `<p>Place a higher bid to reclaim the top spot!</p>`,
  ];

  if (safeBidAgainUrl) {
    htmlParts.push(`<p><a href="${safeBidAgainUrl}">Bid again</a></p>`);
  }

  const html = htmlParts.join('\n');

  const textParts = [
    `Hi ${recipientName},`,
    '',
    `Someone has outbid you on ${categoryName} on Topbid.`,
    '',
    `Your bid of ${previousFormatted} has been surpassed by ${newBidderLabel} with a new top bid of ${newFormatted}.`,
    '',
    'Place a higher bid to reclaim the top spot!',
  ];

  if (bidAgainUrl) {
    textParts.push('', `Bid again: ${bidAgainUrl}`);
  }

  const text = textParts.join('\n');

  return {
    to: input.to,
    subject,
    html,
    text,
  };
}
