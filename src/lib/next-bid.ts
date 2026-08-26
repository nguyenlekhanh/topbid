import { createServiceClient } from '@/lib/supabase-service';
import { validateCategory } from '@/lib/categories';

/**
 * Authoritative next-bid derivation for the console bidding UX.
 *
 * BUSINESS RULE (migration 20260823000023 is the enforcement authority):
 *   nextBid = current maximum reservation + $1 (100 cents)
 *   - category selected  -> that category's maximum + $1 ; $1 when it has none
 *   - no selection       -> the GLOBAL maximum across all categories + $1, targeting
 *                           the leading category ; $1 when the database has no bids
 *
 * There are NO other fallbacks. In particular there is no starting-bid/increment
 * fallback anywhere in this flow: an empty database or empty category prices the next
 * bid at exactly $1.
 *
 * The derived amount is a PRE-VALIDATION convenience only: create_pending_bid
 * recomputes the identical floor inside its row lock and rejects stale amounts, so a
 * race between derivation and payment can never produce an under-minimum paid bid.
 */

export type NextBidResolution =
  | {
      ok: true;
      categorySlug: string;
      categoryId: string;
      categoryName: string;
      amount: number;
    }
  | { ok: false; reason: 'category_not_found' | 'no_active_categories' };

type GlobalHighestRow = {
  id: string;
  amount: number;
  category_id: string;
  categories: { slug: string; name: string } | null;
};

const FIRST_BID_CENTS = 100; // $1.00

export async function resolveNextBid(options: {
  categorySlug?: unknown;
}): Promise<NextBidResolution> {
  const slug = typeof options.categorySlug === 'string' ? options.categorySlug.trim() : '';

  if (slug) {
    // Unknown/inactive slugs must error - never silently re-target another category.
    const validation = await validateCategory(slug);

    if (!validation.valid) {
      return { ok: false, reason: 'category_not_found' };
    }

    const maxCents = await maxReservationForCategory(validation.category.id);

    return {
      ok: true,
      categorySlug: validation.category.slug,
      categoryId: validation.category.id,
      categoryName: validation.category.name,
      amount: nextAmount(maxCents),
    };
  }

  // No category chosen: follow the GLOBAL leading reservation.
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from('bids')
    .select('id, amount, category_id, categories (slug, name)')
    .in('status', ['paid', 'pending'])
    .order('amount', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch global highest bid: ${error.message}`);
  }

  const globalHighest = data as unknown as GlobalHighestRow | null;

  if (globalHighest?.categories?.slug) {
    return {
      ok: true,
      categorySlug: globalHighest.categories.slug,
      categoryId: globalHighest.category_id,
      categoryName: globalHighest.categories.name ?? '',
      amount: nextAmount(globalHighest.amount),
    };
  }

  // Empty database: $1 on the first active category (existing listing order).
  const categories = await listActiveCategories();
  const first = categories[0];

  if (!first) {
    return { ok: false, reason: 'no_active_categories' };
  }

  return {
    ok: true,
    categorySlug: first.slug,
    categoryId: first.id,
    categoryName: first.name,
    amount: FIRST_BID_CENTS,
  };
}

function nextAmount(maxCents: number | null): number {
  return maxCents === null ? FIRST_BID_CENTS : maxCents + 100;
}

async function maxReservationForCategory(categoryId: string): Promise<number | null> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from('bids')
    .select('amount')
    .eq('category_id', categoryId)
    .in('status', ['paid', 'pending'])
    .order('amount', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch category maximum bid: ${error.message}`);
  }

  return (data as { amount: number } | null)?.amount ?? null;
}

async function listActiveCategories(): Promise<Array<{ id: string; slug: string; name: string }>> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from('categories')
    .select('id, slug, name')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to list active categories: ${error.message}`);
  }

  return ((data as unknown as Array<{ id: string; slug: string; name: string }>) ?? []).map(
    (row) => ({ id: row.id, slug: row.slug, name: row.name })
  );
}
