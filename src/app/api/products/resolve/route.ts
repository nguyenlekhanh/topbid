import { NextResponse } from 'next/server';

import { resolveProductPreview, type ProductFailureReason } from '@/lib/product-resolver';
import { getClientIp, RATE_LIMIT_RULES, rateLimiters } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const FAILURE_STATUS: Record<ProductFailureReason, number> = {
  invalid_input: 400,
  unsupported_handle: 400,
  unsafe_url: 400,
  not_html: 422,
  not_found: 404,
  timeout: 504,
  response_too_large: 422,
  fetch_failed: 502,
};

/**
 * Resolve a user-supplied product URL into normalized preview metadata.
 *
 * - Input contract: { input } only. No category, no bid amount, no identity fields -
 *   this endpoint never touches bids, Stripe, or the database and never persists
 *   anything. Preview-only.
 * - The @handle form returns typed unsupported_handle (no platform is established in
 *   the repository); nothing is guessed or searched on the user's behalf.
 * - Outbound fetching enforces SSRF protections (public http(s) hosts only, DNS
 *   resolution checks, bounded redirects/size/time) inside product-resolver.ts.
 * - Failures return stable generic reasons; upstream bodies/diagnostics stay server-side.
 */
export async function POST(request: Request) {
  if (
    !rateLimiters.productResolve.check(getClientIp(request), RATE_LIMIT_RULES.productResolve)
      .allowed
  ) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const input =
    typeof payload === 'object' && payload !== null
      ? (payload as { input?: unknown }).input
      : undefined;

  try {
    const result = await resolveProductPreview(input);

    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: FAILURE_STATUS[result.reason] });
    }

    return NextResponse.json({ preview: result.preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error('[product-resolve] unexpected failure:', message);

    return NextResponse.json({ error: 'resolve_failed' }, { status: 500 });
  }
}
