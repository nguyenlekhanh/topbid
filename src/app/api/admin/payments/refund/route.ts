import { NextResponse } from 'next/server';

import { getAdminContext } from '@/lib/admin-auth';
import { initiateAdminRefund } from '@/lib/admin-refunds';
import { RATE_LIMIT_RULES, rateLimiters } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * Admin refund action endpoint (Task 8.6) with per-admin rate limiting (Task 9.2).
 *
 * - Accepts POST { bid_id } as JSON or form data
 * - Authorization first: getAdminContext() verifies the caller is an authenticated
 *   admin; unauthenticated/unauthorized callers are redirected to the login page
 *   before any Stripe or database work
 * - Task 9.2: refund attempts are capped per admin identity (RATE_LIMIT_RULES.refund,
 *   20/hour). The cap applies AFTER authorization so only real administrators consume
 *   it, and Stripe-side idempotency (admin-refund-<bidId> key) plus the ledger make
 *   repeated attempts safe no-ops
 * - Outcomes land back on /admin/payments with stable flags:
 *   ?result=refunded|already_refunded|refund_submitted or ?error=<reason>
 */
export async function POST(request: Request) {
  const requestUrl = new URL(request.url);

  const context = await getAdminContext();

  if (!context.authorized) {
    return redirectTo(requestUrl, {}, '/admin/login');
  }

  // Task 9.2: per-admin refund burst cap (fail closed for this request only).
  if (!rateLimiters.refund.check('admin:' + context.userId, RATE_LIMIT_RULES.refund).allowed) {
    return redirectTo(requestUrl, { error: 'rate_limited' }, '/admin/payments');
  }

  const bidId = await readBidId(request);

  const result = await initiateAdminRefund({ bidId });

  if (!result.ok) {
    if (result.reason === 'unauthorized') {
      return redirectTo(requestUrl, {}, '/admin/login');
    }

    return redirectTo(requestUrl, { error: result.reason });
  }

  return redirectTo(requestUrl, { result: result.outcome });
}

function redirectTo(
  requestUrl: URL,
  params: Record<string, string>,
  pathname = '/admin/payments'
): NextResponse {
  const destination = new URL(pathname, requestUrl);

  for (const [key, value] of Object.entries(params)) {
    destination.searchParams.set(key, value);
  }

  return NextResponse.redirect(destination, 303);
}

async function readBidId(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      const body = (await request.json()) as { bid_id?: unknown };

      return body.bid_id;
    } catch {
      return undefined;
    }
  }

  const form = await request.formData();
  const value = form.get('bid_id');

  return typeof value === 'string' ? value : undefined;
}
