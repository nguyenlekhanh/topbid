import { createClient } from '@/lib/supabase-server';

/**
 * Server-only admin authentication/authorization foundation (Task 8.1).
 *
 * WHO IS AN ADMIN:
 *   A Supabase Auth user whose id exists in public.admin_users. Session possession
 *   alone never grants admin access - membership is verified per request.
 *
 * WHAT PROVES IT:
 *   A valid Supabase Auth session (HttpOnly cookies managed by @supabase/ssr) AND a
 *   readable own-row in admin_users. Both checks happen server-side on every call;
 *   the RLS policy (id = auth.uid()) means the row lookup runs under the caller's own
 *   JWT - least privilege, no service role involved.
 *
 * FAILURE MODEL (fail closed):
 *   No session, invalid/expired session, missing membership row, or any database
 *   error all resolve to { authorized: false } - infrastructure problems can never
 *   accidentally grant access.
 *
 * REUSABLE GUARD:
 *   Phase 8 tasks (8.2+) call getAdminAuthorization() at the top of every protected
 *   page/route and handle the unauthorized branch themselves (redirect for pages,
 *   401/403 for routes). This module is the single authentication boundary; no logic
 *   may trust client-rendered state, query parameters, or non-Supabase cookies as
 *   proof of admin authorization.
 *
 * Server-only module: uses cookie-backed Supabase server clients; must never be
 * imported by client code.
 */

export type AdminAuthorization = { authorized: true; userId: string } | { authorized: false };

/**
 * Full admin context (Task 8.8): authorization PLUS the authenticated
 * administrator's email, resolved in one pass for audit records.
 */
export type AdminContext =
  { authorized: true; userId: string; email: string } | { authorized: false };

export async function getAdminContext(): Promise<AdminContext> {
  const supabase = await createClient();

  const { data: authData, error: userError } = await supabase.auth.getUser();

  const user = authData?.user;

  if (userError || !user?.id) {
    return { authorized: false };
  }

  // Self-read only: RLS policy admin_users_select_own restricts this lookup to the
  // caller's own row, so the result cannot be widened by input manipulation.
  const { data, error } = await supabase
    .from('admin_users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !data) {
    return { authorized: false };
  }

  return { authorized: true, userId: user.id, email: user.email ?? '' };
}

export async function getAdminAuthorization(): Promise<AdminAuthorization> {
  const context = await getAdminContext();

  if (!context.authorized) {
    return { authorized: false };
  }

  return { authorized: true, userId: context.userId };
}

/**
 * Sanitize a post-login redirect target against open redirects: only same-origin
 * relative paths are accepted - must start with '/', and must NOT start with '//'
 * or '/\', both of which browsers normalize into protocol-relative URLs pointing at
 * an attacker-chosen origin. Anything else falls back to null so callers can
 * substitute their safe default.
 */
export function sanitizeNextPath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return null;
  }

  return trimmed;
}
