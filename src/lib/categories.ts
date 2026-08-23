import { createClient } from '@/lib/supabase-server';

export type Category = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  starting_bid: number;
  increment: number;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const CATEGORY_FIELDS =
  'id, slug, name, description, starting_bid, increment, image_url, is_active, created_at, updated_at';

export async function listCategories(): Promise<Category[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('categories')
    .select(CATEGORY_FIELDS)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to list categories: ${error.message}`);
  }

  return (data as Category[]) ?? [];
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  if (!slug || typeof slug !== 'string') {
    return null;
  }

  const normalized = slug.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('categories')
    .select(CATEGORY_FIELDS)
    .eq('slug', normalized)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch category "${normalized}": ${error.message}`);
  }

  return (data as Category | null) ?? null;
}

export type CategoryValidationFailureReason = 'invalid_slug' | 'category_not_found';

export type CategoryValidation =
  | { valid: true; category: Category }
  | { valid: false; reason: CategoryValidationFailureReason; category: null };

/**
 * Validate an untrusted category slug against the authoritative database.
 * - The slug parameter is typed `unknown` deliberately: it originates from the client,
 *   so its shape is validated at runtime regardless of any upstream typing
 * - Accepts only a slug identifier; client-provided category fields (name, starting_bid,
 *   increment, etc.) are never used - the returned category is always the DB row
 * - getCategoryBySlug enforces is_active = true at the app level and RLS exposes only
 *   active categories publicly, so missing and inactive categories are indistinguishable
 *   by design ('category_not_found' covers both, no information leak)
 * - Server-side only (uses supabase-server anon client; respects RLS; never uses the
 *   service-role key)
 * - Bid-amount validation against this category remains Task 3.3's validateBidAmount;
 *   pending-bid creation is Task 3.5
 */
export async function validateCategory(slug: unknown): Promise<CategoryValidation> {
  if (typeof slug !== 'string') {
    return { valid: false, reason: 'invalid_slug', category: null };
  }

  const normalized = slug.trim();

  if (!normalized) {
    return { valid: false, reason: 'invalid_slug', category: null };
  }

  const category = await getCategoryBySlug(normalized);

  if (!category) {
    return { valid: false, reason: 'category_not_found', category: null };
  }

  return { valid: true, category };
}
