import { NextResponse } from 'next/server';

import { isValidUnsubscribeTokenShape, unsubscribeByToken } from '@/lib/unsubscribe';

// Token verification uses Node crypto (HMAC); keep the default Node.js runtime
// explicit for clarity.
export const runtime = 'nodejs';

/**
 * Unsubscribe endpoint (Task 6.6).
 *
 * - Accepts the recipient capability token via query string (RFC 8058 one-click
 *   List-Unsubscribe-POST from mailbox providers sends an empty body to the URL in the
 *   header) or via form body (the /unsubscribe confirmation page's button)
 * - Only POST is served: unsubscription mutates state and must never fire on link
 *   prefetching by email security scanners (which issue GETs)
 * - The token is an HMAC-SHA256 digest of the lowercased email with a server-only
 *   secret - it cannot be forged for another recipient and contains no address data
 * - Idempotent: repeated submissions are no-op upserts reported as already-unsubscribed
 * - Responses are 303 redirects back to the /unsubscribe page, which renders the
 *   AUTHORITATIVE suppression state; no endpoint response ever leaks whether an
 *   arbitrary token/email exists beyond what the redirect target shows its holder
 */
export async function POST(request: Request) {
  const url = new URL(request.url);

  let token = url.searchParams.get('token');

  if (!token) {
    try {
      const form = await request.formData();
      const formToken = form.get('token');
      token = typeof formToken === 'string' ? formToken : null;
    } catch {
      // Empty/malformed body (e.g. provider one-click posts without payload fields).
      token = null;
    }
  }

  if (!isValidUnsubscribeTokenShape(token)) {
    return NextResponse.redirect(new URL('/unsubscribe', request.url), 303);
  }

  await unsubscribeByToken(token);

  return NextResponse.redirect(
    new URL(`/unsubscribe?token=${encodeURIComponent(token)}&submitted=1`, request.url),
    303
  );
}
