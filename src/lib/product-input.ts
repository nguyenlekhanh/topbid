import { createHash } from 'node:crypto';

/**
 * Product URL / @handle normalization and validation (UI redesign task).
 *
 * The bid console collects ONE user-supplied identifier: either an https product URL
 * or an @handle. It is PUBLIC display data (shown on the leaderboard) - never a secret,
 * never an email address.
 *
 * Accepted forms:
 *   - https://example.com/product/my-product   (http(s) URLs with a real hostname;
 *                                               no credentials, no whitespace)
 *   - @myhandle                                (1-30 chars of [a-z0-9._] after the @,
 *                                               stored lowercase)
 *
 * bids.bidder_name is the existing compatible column for this public display value
 * (max 100 chars). bids.bidder_email stays NOT NULL per schema, so a deterministic
 * synthetic address is derived for rows created through this flow - outbid mail to it
 * fails harmlessly inside the existing best-effort delivery path until the operator
 * decides on a notification strategy for the new UX.
 */

const MAX_LENGTH = 200;
const HANDLE_PATTERN = /^@([a-z0-9._]{1,30})$/;

export type NormalizedProductInput =
  { ok: true; value: string; kind: 'url' | 'handle' } | { ok: false; reason: 'invalid_product' };

export function normalizeProductInput(raw: unknown): NormalizedProductInput {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'invalid_product' };
  }

  const trimmed = raw.trim();

  if (!trimmed || trimmed.length > MAX_LENGTH || /\s/.test(trimmed)) {
    return { ok: false, reason: 'invalid_product' };
  }

  if (trimmed.startsWith('@')) {
    const handle = trimmed.toLowerCase();

    return HANDLE_PATTERN.test(handle)
      ? { ok: true, value: handle, kind: 'handle' }
      : { ok: false, reason: 'invalid_product' };
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return { ok: false, reason: 'invalid_product' };
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid_product' };
  }

  // Open-redirect/injection hardening: only clean http(s) origins with a hostname are
  // accepted; embedded credentials and exotic schemes are rejected outright.
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    !parsed.hostname ||
    !parsed.hostname.includes('.') ||
    parsed.username ||
    parsed.password
  ) {
    return { ok: false, reason: 'invalid_product' };
  }

  return { ok: true, value: parsed.toString(), kind: 'url' };
}

/**
 * Deterministic stand-in address satisfying the bids.bidder_email NOT NULL constraint
 * for product-only bidders. It is derived FROM the normalized product value, carries no
 * user PII, and is not expected to receive mail.
 */
export function syntheticBidderEmail(normalizedProduct: string): string {
  const digest = createHash('sha256').update(normalizedProduct).digest('hex').slice(0, 16);

  return `noreply+${digest}@topbid.lol`;
}
