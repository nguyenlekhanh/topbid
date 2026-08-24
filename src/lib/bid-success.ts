import type { BidWithCategory } from '@/lib/bids';

/**
 * Bid success view resolution (Task 7.1).
 *
 * Pure decision logic for /success so every state the page can render is
 * deterministically testable without DOM tooling. The session identifier arrives from
 * the URL and is untrusted input:
 *
 * - Only a single string value is accepted (Next.js delivers string | string[] |
 *   undefined; repeated query keys must never crash the page)
 * - Blank/oversized identifiers normalize to "no identifier" (mirrors the lookup
 *   guards in getBidByStripeSessionId)
 * - The awaiting state echoes at most the first 64 characters of the identifier -
 *   sanitized display only, never used for authorization or lookups beyond the
 *   RLS-guarded read the page already performs
 * - Every displayed confirmed value comes from the AUTHORITATIVE database row; the
 *   page can only see status='paid' bids (RLS), so a still-pending payment renders as
 *   awaiting confirmation exactly as in Task 4.3
 */

const MAX_STRIPE_SESSION_ID_LENGTH = 255;
const MAX_REFERENCE_ECHO_LENGTH = 64;

/**
 * Extract a usable session id from a raw searchParams record. Returns null for
 * missing, non-string, array-valued (repeated key), blank, or oversized values.
 */
export function extractSessionId(
  searchParams: Record<string, string | string[] | undefined>
): string | null {
  const value = searchParams.session_id;

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed.length > MAX_STRIPE_SESSION_ID_LENGTH) {
    return null;
  }

  return trimmed;
}

export type BidSuccessView =
  | {
      view: 'confirmed';
      amountCents: number;
      categoryName: string | null;
      reference: string;
    }
  | { view: 'awaiting'; reference: string | null };

/**
 * Map an (optional) authoritative lookup result to the view the page renders.
 *
 * - null/blank sessionId or no visible bid -> 'awaiting' with a sanitized reference
 *   echo (covers missing ids, unknown sessions, and payments still pending webhook
 *   conversion - RLS makes those indistinguishable by design)
 * - paid bid row -> 'confirmed' carrying ONLY DB-sourced data; client-supplied values
 *   are never rendered as bid facts
 */
export function resolveBidSuccessView(
  sessionId: string | null,
  lookup: BidWithCategory | null
): BidSuccessView {
  const normalized = sessionId?.trim() || null;

  if (!normalized || !lookup) {
    return {
      view: 'awaiting',
      reference: normalized ? normalized.slice(0, MAX_REFERENCE_ECHO_LENGTH) : null,
    };
  }

  return {
    view: 'confirmed',
    amountCents: lookup.bid.amount,
    categoryName: lookup.category?.name ?? null,
    reference: lookup.bid.stripe_session_id ?? '',
  };
}
