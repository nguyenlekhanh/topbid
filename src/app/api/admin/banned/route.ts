import { NextResponse } from 'next/server';

import { banEmail, unbanEmail } from '@/lib/email-bans';

export const runtime = 'nodejs';

/**
 * Banned-email management endpoint (Task 8.7).
 *
 * - intent=ban {email}      -> idempotent insert (banned | already_banned)
 * - intent=unban {email}    -> delete (unbanned | not_banned)
 * - intent=list             -> full blocklist (canonical emails + timestamps)
 * - Authorization enforced server-side inside every operation; unauthorized
 *   requests are redirected to the login page before any database access
 */
function redirectTo(
  requestUrl: URL,
  params: Record<string, string>,
  pathname = '/admin/banned'
): NextResponse {
  const destination = new URL(pathname, requestUrl);

  for (const [key, value] of Object.entries(params)) {
    destination.searchParams.set(key, value);
  }

  return NextResponse.redirect(destination, 303);
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return redirectTo(requestUrl, { error: 'invalid_email' });
  }

  const intent = String(form.get('intent') ?? '');
  const email = form.get('email');

  if (intent === 'ban') {
    const result = await banEmail(email);

    if (!result.ok) {
      if (result.reason === 'unauthorized') {
        return redirectTo(requestUrl, {}, '/admin/login');
      }

      return redirectTo(requestUrl, { error: result.reason });
    }

    return redirectTo(requestUrl, { result: result.outcome });
  }

  if (intent === 'unban') {
    const result = await unbanEmail(email);

    if (!result.ok) {
      if (result.reason === 'unauthorized') {
        return redirectTo(requestUrl, {}, '/admin/login');
      }

      return redirectTo(requestUrl, { error: result.reason });
    }

    return redirectTo(requestUrl, { result: result.outcome });
  }

  if (intent === 'list') {
    // List is served by the page itself via listBannedEmails; POST/list exists only
    // for completeness and redirects like every other intent.
    return redirectTo(requestUrl, {});
  }

  return redirectTo(requestUrl, { error: 'invalid_intent' });
}
