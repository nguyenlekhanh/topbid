import type { MetadataRoute } from 'next';

import { listCategories } from '@/lib/categories';
import { buildCategoryUrl } from '@/lib/share-url';

/**
 * sitemap.xml via Next.js App Router metadata routes (Task 10.5).
 *
 * Contents are limited to LEGITIMATE public/indexable URLs:
 * - the homepage (/)
 * - one entry per ACTIVE category, built through the existing canonical helper
 *   (buildCategoryUrl percent-encodes the slug into a fixed path segment)
 *
 * Categories come from the same RLS-safe active-only query the public pages use
 * (listCategories), so inactive/nonexistent categories can never be listed and no
 * hard-coded names/slugs exist. No session ids, tokens, payment identifiers,
 * admin routes, or API routes are ever included.
 *
 * Dynamic + data-authoritative: evaluated per request like the category pages it
 * mirrors. If the database cannot be reached, the homepage-only sitemap is served
 * rather than erroring so crawl tooling never sees a broken endpoint; the next
 * request picks categories back up.
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '');

  if (!base) {
    return [];
  }

  const home: MetadataRoute.Sitemap = [{ url: `${base}/` }];

  try {
    const categories = await listCategories();

    return [
      ...home,
      ...categories.map((category) => ({ url: buildCategoryUrl(base, category.slug) })),
    ];
  } catch {
    return home;
  }
}
