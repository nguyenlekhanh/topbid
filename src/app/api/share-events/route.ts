import { NextResponse } from 'next/server';

import { createServiceClient } from '@/lib/supabase-service';
import { getClientIp, RATE_LIMIT_RULES, rateLimiters } from '@/lib/rate-limit';
import { isShareEvent } from '@/lib/share-tracking';

// Writes go through the service-role Supabase client (Node-only SDK path); keep the
// default Node.js runtime explicit for clarity.
export const runtime = 'nodejs';

/**
 * Share-event ingestion endpoint (Task 7.7) with rate limiting (Task 9.2).
 *
 * - Accepts POST {event: 'x_share' | 'copy_link'} - the allow-list is the entire input
 *   contract; nothing else about the request is persisted
 * - Task 9.2: per-IP fixed-window cap on telemetry writes (fail closed)
 * - Non-authoritative observability: rows are never read by bidding, payment,
 *   notification, or page-render logic
 * - Idempotency/duplicates: every accepted POST inserts one row - repeated user
 *   actions intentionally count as separate events (no dedup rule exists in the plan)
 * - Errors: malformed body/unknown event -> 400; rate exceeded -> 429 with
 *   Retry-After; database failure -> 500. Clients are fire-and-forget and ignore all
 *   responses
 */
export async function POST(request: Request) {
  if (!rateLimiters.shareEvents.check(getClientIp(request), RATE_LIMIT_RULES.shareEvents).allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const event =
    typeof payload === 'object' && payload !== null ? (payload as { event?: unknown }).event : null;

  if (!isShareEvent(event)) {
    return NextResponse.json({ error: 'Invalid share event' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { error } = await supabase.from('share_events').insert({ event });

  if (error) {
    return NextResponse.json({ error: 'Failed to record share event' }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
