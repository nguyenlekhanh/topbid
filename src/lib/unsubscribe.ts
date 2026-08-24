import { createHmac } from 'node:crypto';

import { createServiceClient } from '@/lib/supabase-service';

/**
 * Application-managed unsubscribe handling for outbid notifications (Task 6.6).
 *
 * Recipients have no accounts (MVP constraint), so a recipient-specific capability
 * token identifies them securely:
 *
 *   token = HEX(HMAC-SHA256(UNSUBSCRIBE_SECRET, lowercased_email))
 *
 * - The token is deterministic per recipient: it is both the value carried in
 *   unsubscribe URLs and the PRIMARY KEY stored in notification_unsubscribes, so a
 *   lookup by token resolves the suppression state directly without ever storing or
 *   exposing the raw email address in this table
 * - The token cannot be forged, guessed, or reversed without UNSUBSCRIBE_SECRET (a
 *   server-only secret, minimum 32 characters); it cannot be used to unsubscribe any
 *   other address than the one it was issued for
 * - Suppression is enforced server-side BEFORE an outbid email is composed/sent;
 *   unsubscribed recipients never receive future notifications through that flow
 *
 * Server-only module: imports the service-role client and the signing secret; must
 * never be imported by client code.
 */

const MIN_SECRET_LENGTH = 32;

let cachedSecret: string | null = null;

/**
 * Resolve and validate UNSUBSCRIBE_SECRET lazily with memoization. Validation happens
 * at use time rather than module load because Next.js evaluates route/page modules
 * during build page-data collection (same reasoning as the Resend integration).
 */
function getUnsubscribeSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET;

  if (!secret || !secret.trim()) {
    throw new Error(
      'Missing UNSUBSCRIBE_SECRET environment variable: required to build/verify unsubscribe tokens'
    );
  }

  const trimmed = secret.trim();

  if (trimmed.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `UNSUBSCRIBE_SECRET must be at least ${MIN_SECRET_LENGTH} characters (e.g. openssl rand -hex 32)`
    );
  }

  if (cachedSecret !== trimmed) {
    cachedSecret = trimmed;
  }

  return trimmed;
}

function normalizeRecipientEmail(email: string): string | null {
  if (typeof email !== 'string') {
    return null;
  }

  const normalized = email.trim().toLowerCase();

  if (!normalized || normalized.length > 254) {
    return null;
  }

  return normalized;
}

/**
 * Compute the stable recipient token/hash for an email address. Returns null for
 * malformed input instead of throwing - callers decide how to handle unidentifiable
 * recipients.
 */
export function getUnsubscribeToken(email: string): string | null {
  const normalized = normalizeRecipientEmail(email);

  if (!normalized) {
    return null;
  }

  return createHmac('sha256', getUnsubscribeSecret()).update(normalized).digest('hex');
}

/**
 * Build the absolute unsubscribe URL for a recipient footer link.
 * Uses NEXT_PUBLIC_APP_URL exactly like the other notification links; missing
 * configuration throws descriptively rather than sending a broken link.
 */
export function buildUnsubscribeUrl(email: string): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL;

  if (!base || !base.trim()) {
    throw new Error('Missing NEXT_PUBLIC_APP_URL: required to build the unsubscribe link');
  }

  const token = getUnsubscribeToken(email);

  if (!token) {
    return null;
  }

  return `${base.trim().replace(/\/+$/, '')}/unsubscribe?token=${token}`;
}

/**
 * RFC 8058 / RFC 2369 transport headers advertising one-click unsubscription through
 * the POST endpoint carrying the same capability token. Pure helper - no network.
 */
export function listUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * Unsubscribe URL tokens are hex HMAC-SHA256 digests; anything else is malformed by
 * construction. Shape validation only - possession of a well-shaped token that does
 * not match any recipient simply records a harmless unknown key (it grants nothing).
 */
export function isValidUnsubscribeTokenShape(token: unknown): token is string {
  return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token);
}

export type UnsubscribeOutcome = 'unsubscribed' | 'already_unsubscribed';

/**
 * Record an unsubscribe for the token's recipient. Idempotent: repeated submissions of
 * the same token are ON CONFLICT DO NOTHING no-ops reported as
 * 'already_unsubscribed'. Service-role write (RLS grants nobody access to this table
 * by design).
 */
export async function unsubscribeByToken(token: string): Promise<UnsubscribeOutcome> {
  if (!isValidUnsubscribeTokenShape(token)) {
    throw new Error('Invalid unsubscribe token');
  }

  const supabase = createServiceClient();

  const { count, error } = await supabase
    .from('notification_unsubscribes')
    .upsert(
      { recipient_hash: token.toLowerCase() },
      { onConflict: 'recipient_hash', ignoreDuplicates: true, count: 'exact' }
    );

  if (error) {
    throw new Error(`Failed to record unsubscribe: ${error.message}`);
  }

  // PostgREST reports inserted-row count; an ignored duplicate inserts nothing.
  return (count ?? 0) > 0 ? 'unsubscribed' : 'already_unsubscribed';
}

/**
 * Authoritative suppression check by TOKEN - used by the /unsubscribe page, which
 * holds a capability token rather than a recipient address. Malformed tokens are
 * simply "not unsubscribed" (the page renders its own neutral copy for them).
 */
export async function hasUnsubscribeRecord(token: string): Promise<boolean> {
  if (!isValidUnsubscribeTokenShape(token)) {
    return false;
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('notification_unsubscribes')
    .select('recipient_hash')
    .eq('recipient_hash', token.toLowerCase())
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check unsubscribe state: ${error.message}`);
  }

  return data !== null;
}

/**
 * Authoritative suppression check used before composing/sending an outbid
 * notification. Unsubscribed recipients must never receive future emails through
 * that flow. Malformed/unidentifiable emails are treated as NOT unsubscribed so the
 * caller's existing guards decide their fate.
 */
export async function isUnsubscribed(email: string): Promise<boolean> {
  const token = getUnsubscribeToken(email);

  if (!token) {
    return false;
  }

  return hasUnsubscribeRecord(token);
}
