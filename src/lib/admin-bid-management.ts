import { createServiceClient } from '@/lib/supabase-service';
import { getAdminAuthorization } from '@/lib/admin-auth';

/**
 * Server-only bid management read model (Task 8.4).
 *
 * Bid management is deliberately READ-ONLY: bid status transitions (pending -> paid,
 * -> failed, -> refunded) are payment-authoritative state owned exclusively by the
 * verified-webhook RPCs of Tasks 4.8-4.11 inside their ledger transactions. There is
 * no admin mutation here because none can exist without either duplicating those
 * transaction boundaries (forbidden alternate payment path) or inventing
 * refund/failure workflows that belong to later tasks.
 *
 * The public RLS policy exposes only PAID bids; operational oversight requires seeing
 * every status, so this isolated server-only read uses the service role behind the
 * same Task 8.1 authorization gate as all other admin modules.
 *
 * Data minimization:
 * - Column selection excludes bidder_email, stripe_session_id, stripe_payment_intent_id,
 *   and internal ids at the QUERY level
 * - Rows are additionally mapped through an explicit allow-list picker, so even an
 *   over-provisioned database response cannot leak sensitive fields into the view model
 * - Latest 100 bids (bounded read window; not pagination infrastructure)
 */

export type AdminBidStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export type AdminBidRow = {
  categoryName: string | null;
  bidderName: string | null;
  amountCents: number;
  status: AdminBidStatus;
  createdAt: string;
  paidAt: string | null;
};

const BID_WINDOW_LIMIT = 100;

export async function listAllBidsForAdmin(): Promise<
  { ok: true; bids: AdminBidRow[] } | { ok: false; reason: 'unauthorized' | 'db_error' }
> {
  if (!(await getAdminAuthorization()).authorized) {
    return { ok: false, reason: 'unauthorized' };
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('bids')
    .select('created_at, amount, status, bidder_name, paid_at, categories ( name )')
    .order('created_at', { ascending: false })
    .limit(BID_WINDOW_LIMIT);

  if (error) {
    console.error('[admin-bids] list failed:', error.message);

    return { ok: false, reason: 'db_error' };
  }

  type RawRow = {
    created_at: string;
    amount: number;
    status: string;
    bidder_name: string | null;
    paid_at: string | null;
    categories: { name: string } | null;
  };

  const bids = ((data as unknown as RawRow[]) ?? []).map((row): AdminBidRow => ({
    categoryName: row.categories?.name ?? null,
    bidderName: row.bidder_name,
    amountCents: row.amount,
    status: (['pending', 'paid', 'failed', 'refunded'] as const).includes(
      row.status as AdminBidStatus
    )
      ? (row.status as AdminBidStatus)
      : 'pending',
    createdAt: row.created_at,
    paidAt: row.paid_at,
  }));

  return { ok: true, bids };
}
