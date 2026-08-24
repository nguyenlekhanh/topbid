import { NextResponse } from 'next/server';

import { initiateAdminRefund } from '@/lib/admin-refunds';

export const runtime = 'nodejs';

/**
 * Admin refund action endpoint (Task 8.6).
 *
 * - Accepts POST { bid_id } as JSON or form data
 * - The action itself enforces authorization and payment safety (see
 *   src/lib/admin-refunds.ts); this surface only routes input in and redirects out
 * - Outcomes land back on /admin/payments with stable flags:
 *   ?result=refunded|already_refunded|refund_submitted or ?error=<reason>
 */
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

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
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
