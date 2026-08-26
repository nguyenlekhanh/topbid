import { NextResponse } from 'next/server';

import { getBidForecast } from '@/lib/bid-forecast';
import { getClientIp, RATE_LIMIT_RULES, rateLimiters } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * Position-forecast feed for the bid console preview (informational only).
 *
 * GET /api/bids/forecast?category=<slug>
 *
 * Read-only: derives numbers from paid/pending bids exactly like the leaderboard and
 * the create_pending_bid floor. Never authorizes a bid, never touches Stripe, never
 * mutates the database, never exposes private fields.
 */
export async function GET(request: Request) {
  if (!rateLimiters.bidForecast.check(getClientIp(request), RATE_LIMIT_RULES.bidForecast).allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  const category = new URL(request.url).searchParams.get('category') ?? undefined;

  try {
    const forecast = await getBidForecast({ categorySlug: category });

    return NextResponse.json({ forecast }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error('[bid-forecast] failed:', message);

    return NextResponse.json({ error: 'forecast_failed' }, { status: 500 });
  }
}
