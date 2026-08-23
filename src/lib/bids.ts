import { createClient } from '@/lib/supabase-server';

export type Bid = {
  id: string;
  category_id: string;
  amount: number;
  bidder_email: string;
  bidder_name: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  status: string;
  is_highest: boolean | null;
  created_at: string;
  paid_at: string | null;
};

const BID_FIELDS =
  'id, category_id, amount, bidder_email, bidder_name, stripe_session_id, stripe_payment_intent_id, status, is_highest, created_at, paid_at';

/**
 * Get the highest paid bid for a category.
 * - Only considers status = 'paid' (per RLS/public leaderboard and indexes)
 * - Ordered by amount DESC, limit 1
 * - Returns null when no paid bids exist for the category
 * - Server-side only (uses supabase-server anon client, respects RLS)
 */
export async function getHighestBidForCategory(categoryId: string): Promise<Bid | null> {
  if (!categoryId || typeof categoryId !== 'string') {
    return null;
  }

  const normalized = categoryId.trim();

  if (!normalized) {
    return null;
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bids')
    .select(BID_FIELDS)
    .eq('category_id', normalized)
    .eq('status', 'paid')
    .order('amount', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch highest bid for category "${normalized}": ${error.message}`);
  }

  return (data as Bid | null) ?? null;
}
