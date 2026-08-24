/**
 * X (Twitter) share-intent helpers (Task 7.2).
 *
 * - buildXShareText composes claim-free share copy from AUTHORITATIVE values only
 *   (bid amount + category name supplied by the success page's DB-backed view) - no
 *   winner/rank claims, no emails, no session/payment identifiers
 * - buildXShareUrl produces the standard X web-intent URL with correctly encoded
 *   text/url parameters (URLSearchParams percent-encodes spaces, &, ?, #, etc.)
 *
 * Both are pure and deterministic; no network calls happen here - the URL is rendered
 * as a plain anchor that the user opens themselves.
 */

const X_INTENT_BASE = 'https://x.com/intent/tweet';

function formatUsdCents(amountCents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
}

/**
 * Compose concise, claim-free share copy. The category segment is omitted entirely
 * when unavailable rather than guessed. Amounts arrive as integer cents from the
 * authoritative database row.
 */
export function buildXShareText({
  amountCents,
  categoryName,
}: {
  amountCents: number;
  categoryName?: string | null;
}): string {
  const amount = formatUsdCents(amountCents);
  const category = categoryName?.trim();

  return category
    ? `I just bid ${amount} on ${category} on Topbid.lol!`
    : `I just bid ${amount} on Topbid.lol!`;
}

/**
 * Build the X web-intent URL. Both parameters are percent-encoded with
 * encodeURIComponent (canonical RFC 3986-style %20 spaces) so no character can break
 * out of its parameter regardless of content.
 */
export function buildXShareUrl({ text, url }: { text: string; url: string }): string {
  return `${X_INTENT_BASE}?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}
