import { createClient } from '@/lib/supabase';

/**
 * Browser-safe bid queries (anon client, RLS paid-only visibility).
 *
 * Lives separately from ./bids because that module pulls in server-only
 * service-role/Stripe paths that must never enter the browser bundle.
 */

export async function getHighestPaidBidAmountForCategory(
  categoryId: string
): Promise<number | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('bids')
    .select('amount')
    .eq('category_id', categoryId)
    .eq('status', 'paid')
    .order('amount', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch highest paid bid amount: ${error.message}`);
  }

  return (data as { amount: number } | null)?.amount ?? null;
}
