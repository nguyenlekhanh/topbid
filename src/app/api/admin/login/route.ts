import { NextResponse } from 'next/server';

import { sanitizeNextPath } from '@/lib/admin-auth';
import { createClient } from '@/lib/supabase-server';

// Supabase Auth session cookies are set through the @supabase/ssr cookie handlers.
export const runtime = 'nodejs';

const DEFAULT_NEXT = '/admin';
const MAX_CREDENTIAL_LENGTH = 320;

/**
 * Admin login endpoint (Task 8.1).
 *
 * - Verifies email/password credentials server-side via Supabase Auth
 *   (signInWithPassword); the SDK sets HttpOnly session cookies through the
 *   established @supabase/ssr cookie handlers - no client-visible tokens
 * - Authentication errors redirect back to the login page with a generic error flag
 *   (?error=1): responses never reveal whether an email/account exists
 * - Post-login destination honors a `next` form field ONLY after open-redirect
 *   sanitization (same-origin relative paths); everything else falls back to /admin
 * - 303 redirects keep the browser flow on one rendering surface (the login page)
 */
export async function POST(request: Request) {
  const requestUrl = new URL(request.url);

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return NextResponse.redirect(new URL('/admin/login?error=1', requestUrl), 303);
  }

  const email = String(form.get('email') ?? '')
    .trim()
    .slice(0, MAX_CREDENTIAL_LENGTH);
  const password = String(form.get('password') ?? '').slice(0, MAX_CREDENTIAL_LENGTH);
  const next = sanitizeNextPath(form.get('next'));

  if (!email || !password) {
    return NextResponse.redirect(new URL('/admin/login?error=1', requestUrl), 303);
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Generic failure: identical response for unknown emails and wrong passwords.
    return NextResponse.redirect(new URL('/admin/login?error=1', requestUrl), 303);
  }

  // Belt-and-braces origin check: even a path that slipped past sanitization cannot
  // produce a cross-origin redirect, because URL resolution is verified here.
  const target = next ?? DEFAULT_NEXT;
  const resolved = new URL(target, requestUrl);
  const safeDestination =
    resolved.origin === requestUrl.origin ? resolved : new URL(DEFAULT_NEXT, requestUrl);

  return NextResponse.redirect(safeDestination, 303);
}
