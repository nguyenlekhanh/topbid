import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase-server';
import { resolveRedirectDestination, type BidRedirectMetadata } from '@/lib/redirect-resolver';

export const runtime = 'nodejs';

/**
 * Outbound redirect gateway for paid bids.
 *
 * GET /next/[id]
 *
 * - Only paid bids (status = 'paid') can redirect externally
 * - Resolves destination from persisted entry metadata only (no external fetches)
 * - entry_type = 'url' -> redirects to entry_canonical_url (if http/https)
 * - entry_type = 'handle' -> redirects to https://x.com/<handle>
 * - entry_type = 'unknown' or null -> 404
 * - Missing/invalid/pending bids -> 404
 * - Never exposes bidder_email or private metadata
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!id || typeof id !== 'string') {
    return new NextResponse(null, { status: 404 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bids')
    .select('id, status, entry_type, entry_canonical_url, entry_title')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[next] bid lookup failed:', error.message);
    return new NextResponse(null, { status: 404 });
  }

  const bid = data as BidRedirectMetadata | null;

  if (!bid) {
    return new NextResponse(null, { status: 404 });
  }

  const resolution = resolveRedirectDestination(bid);

  if (resolution.ok) {
    return NextResponse.redirect(resolution.destination);
  }

  // 404 for all failure cases (not_paid, invalid_url, no_destination, not_found)
  return new NextResponse(null, { status: 404 });
}
