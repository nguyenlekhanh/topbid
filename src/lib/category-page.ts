import { getCategoryBySlug, type Category } from '@/lib/categories';
import { getHighestBidForCategory, type Bid } from '@/lib/bids';

/**
 * Category page loader (Task 7.4).
 *
 * Resolves the public category URL's data from AUTHORITATIVE sources only:
 *
 * - getCategoryBySlug is the single lookup authority: it normalizes the slug
 *   (trim/lowercase - the URL value is untrusted input), enforces is_active = true at
 *   the app level AND via RLS, and returns null for missing/inactive/malformed slugs
 *   so all three collapse into one safe not-found outcome (no existence leak)
 * - The current top PAID bid comes from the existing getHighestBidForCategory query
 *   (amount DESC, RLS paid-only) - pending bids are never exposed
 *
 * Returns null whenever the category is not publicly resolvable; the page maps that to
 * Next.js notFound(). Pure orchestration over existing queries - no new SQL.
 */
export type CategoryPageData = {
  category: Category;
  highestBid: Bid | null;
};

export async function loadCategoryPageData(slug: string): Promise<CategoryPageData | null> {
  if (typeof slug !== 'string' || !slug.trim()) {
    return null;
  }

  const category = await getCategoryBySlug(slug);

  if (!category) {
    return null;
  }

  const highestBid = await getHighestBidForCategory(category.id);

  return { category, highestBid };
}
