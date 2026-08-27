/**
 * Outbound redirect destination resolver for the /next/[id] gateway.
 *
 * Pure and deterministic: given a paid bid's persisted entry metadata, returns
 * the authoritative outbound URL or a safe fallback. No external network calls.
 */

export type BidRedirectMetadata = {
  id: string;
  status: string;
  entry_type: 'url' | 'handle' | 'unknown' | null;
  entry_canonical_url: string | null;
  entry_title: string | null;
};

export type RedirectResolution =
  | { ok: true; destination: string }
  | { ok: false; reason: 'not_paid' | 'not_found' | 'invalid_url' | 'no_destination' };

const FALLBACK_URL = '/';

/**
 * Validate that a URL is safe for outbound redirect.
 * Only allows http:// and https:// protocols. Rejects javascript:, data:, file:, etc.
 */
function isSafeRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normalize a handle by removing leading @ if present.
 * Only removes a single leading @ to prevent injection.
 */
function normalizeHandle(handle: string): string {
  return handle.startsWith('@') ? handle.slice(1) : handle;
}

/**
 * Resolve the outbound redirect destination for a paid bid.
 * Uses only persisted metadata - no external fetches.
 */
export function resolveRedirectDestination(bid: BidRedirectMetadata): RedirectResolution {
  // Only paid bids can redirect externally
  if (bid.status !== 'paid') {
    return { ok: false, reason: 'not_paid' };
  }

  const entryType = bid.entry_type;

  // Handle entry_type = 'url'
  if (entryType === 'url') {
    const canonicalUrl = bid.entry_canonical_url;
    if (canonicalUrl && isSafeRedirectUrl(canonicalUrl)) {
      return { ok: true, destination: canonicalUrl };
    }
    return { ok: false, reason: 'invalid_url' };
  }

  // Handle entry_type = 'handle'
  if (entryType === 'handle') {
    const title = bid.entry_title;
    if (title && title.startsWith('@')) {
      const handle = normalizeHandle(title);
      // Basic validation: handle should only contain alphanumeric and underscore
      if (/^[a-zA-Z0-9_]+$/.test(handle)) {
        return { ok: true, destination: `https://x.com/${handle}` };
      }
    }
    return { ok: false, reason: 'no_destination' };
  }

  // entry_type = 'unknown' or null - no trusted outbound destination
  return { ok: false, reason: 'no_destination' };
}

/**
 * Get the fallback URL when no valid destination exists.
 * Could be enhanced to point to category page if needed.
 */
export function getFallbackUrl(): string {
  return FALLBACK_URL;
}
