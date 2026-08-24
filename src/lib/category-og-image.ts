/**
 * Content model for the dynamic category OG image (Task 7.6).
 *
 * Pure and deterministic: maps authoritative category data (from
 * loadCategoryPageData) to the exact strings the ImageResponse renders. Rendering
 * itself lives in src/app/categories/[slug]/opengraph-image.tsx via next/og.
 *
 * Data rules:
 * - highestBid present  -> labeled "Current highest bid" with that PAID amount
 *   (the loader only ever surfaces status='paid' bids - pending is never treated as paid)
 * - highestBid absent   -> labeled "Starting bid" with categories.starting_bid, clearly
 *   NOT implying an actual bid was placed
 * - long names/descriptions truncate deterministically so social previews never break
 *   layout; text renders through satori's text primitives (no raw HTML injection path)
 *
 * Sensitive values (bidder email, Stripe session/payment ids, internal bid ids,
 * unsubscribe tokens, bidder names) are deliberately not part of this content model at
 * all - there is no field they could leak into.
 */

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

const MAX_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 120;
const ELLIPSIS = '…';

function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();

  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}${ELLIPSIS}` : trimmed;
}

export type OgImageContent = {
  /** Brand wordmark, top of card. */
  brand: string;
  /** Category display name (truncated). */
  heading: string;
  /** Category description (truncated) or null when absent/blank. */
  tagline: string | null;
  /** "Current highest bid" or "Starting bid" depending on authoritative state. */
  amountLabel: string;
  /** Whole-dollar USD rendering of the authoritative amount. */
  amountText: string;
};

export function buildOgImageContent({
  categoryName,
  categoryDescription,
  startingBidCents,
  highestPaidBidCents,
}: {
  categoryName: string;
  categoryDescription?: string | null;
  startingBidCents: number;
  highestPaidBidCents: number | null;
}): OgImageContent {
  const formatUsd = (cents: number): string =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);

  return {
    brand: 'Topbid.lol',
    heading: truncate(categoryName, MAX_NAME_LENGTH),
    tagline: categoryDescription?.trim()
      ? truncate(categoryDescription, MAX_DESCRIPTION_LENGTH)
      : null,
    amountLabel: highestPaidBidCents === null ? 'Starting bid' : 'Current highest bid',
    amountText: formatUsd(highestPaidBidCents ?? startingBidCents),
  };
}
