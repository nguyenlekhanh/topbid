import { createServiceClient } from '@/lib/supabase-service';
import { getAdminAuthorization } from '@/lib/admin-auth';

/**
 * Banned/fraudulent email management (Task 8.7).
 *
 * Canonical identity: lower(trimmed(raw email)) - stored as email_canonical UNIQUE so
 * duplicate bans are deterministic ON CONFLICT DO NOTHING no-ops, and enforcement
 * lookups match case-insensitively against the addresses bids store (bids keep the
 * trimmed original casing).
 *
 * Enforcement points (server-side, authoritative):
 * - createPendingBid rejects banned emails before a pending bid / Checkout session can
 *   exist ('banned_email')
 * - sendOutbidNotification skips banned recipients ('recipient_banned')
 *
 * This is FRAUD state managed by administrators; it is deliberately separate from
 * notification_unsubscribes (consent state, HMAC-hashed, Task 6.6). Neither list
 * substitutes for the other.
 *
 * Server-only module: service-role access to an RLS-locked table (zero policies);
 * admin operations are gated through the Task 8.1 authorization boundary and fail
 * closed. Must never be imported by client code.
 */

const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function canonicalizeEmail(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : '';

  if (!trimmed || trimmed.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export async function isEmailBanned(email: string): Promise<boolean> {
  const canonical = canonicalizeEmail(email);

  if (!canonical) {
    return false;
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('banned_emails')
    .select('email_canonical')
    .eq('email_canonical', canonical)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check ban state: ${error.message}`);
  }

  return data !== null;
}

/**
 * Ban an address. Idempotent: re-banning an already-banned address resolves to
 * 'already_banned' via ON CONFLICT DO NOTHING (row-count based outcome).
 */
export async function banEmail(
  email: unknown
): Promise<
  | { ok: true; outcome: 'banned' | 'already_banned' }
  | { ok: false; reason: 'unauthorized' | 'invalid_email' | 'db_error' }
> {
  if (!(await getAdminAuthorization()).authorized) {
    return { ok: false, reason: 'unauthorized' };
  }

  const canonical = canonicalizeEmail(email);

  if (!canonical) {
    return { ok: false, reason: 'invalid_email' };
  }

  const supabase = createServiceClient();

  const { count, error } = await supabase
    .from('banned_emails')
    .upsert(
      { email_canonical: canonical },
      { onConflict: 'email_canonical', ignoreDuplicates: true, count: 'exact' }
    );

  if (error) {
    return { ok: false, reason: 'db_error' };
  }

  return { ok: true, outcome: (count ?? 0) > 0 ? 'banned' : 'already_banned' };
}

/** Remove a ban. Deleting a non-existent ban resolves to 'not_banned' (no error). */
export async function unbanEmail(
  email: unknown
): Promise<
  | { ok: true; outcome: 'unbanned' | 'not_banned' }
  | { ok: false; reason: 'unauthorized' | 'invalid_email' | 'db_error' }
> {
  if (!(await getAdminAuthorization()).authorized) {
    return { ok: false, reason: 'unauthorized' };
  }

  const canonical = canonicalizeEmail(email);

  if (!canonical) {
    return { ok: false, reason: 'invalid_email' };
  }

  const supabase = createServiceClient();

  const { count, error } = await supabase
    .from('banned_emails')
    .delete({ count: 'exact' })
    .eq('email_canonical', canonical);

  if (error) {
    return { ok: false, reason: 'db_error' };
  }

  return { ok: true, outcome: (count ?? 0) > 0 ? 'unbanned' : 'not_banned' };
}

export async function listBannedEmails(): Promise<
  | { ok: true; bans: Array<{ emailCanonical: string; createdAt: string }> }
  | { ok: false; reason: 'unauthorized' | 'db_error' }
> {
  if (!(await getAdminAuthorization()).authorized) {
    return { ok: false, reason: 'unauthorized' };
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('banned_emails')
    .select('email_canonical, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, reason: 'db_error' };
  }

  type Row = { email_canonical: string; created_at: string };

  const bans = ((data as unknown as Row[]) ?? []).map((row) => ({
    emailCanonical: row.email_canonical,
    createdAt: row.created_at,
  }));

  return { ok: true, bans };
}
