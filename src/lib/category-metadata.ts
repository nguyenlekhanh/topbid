import type { Metadata } from 'next';

import type { Category } from '@/lib/categories';
import { buildCategoryUrl } from '@/lib/share-url';

/**
 * Open Graph metadata construction for public category pages (Task 7.5).
 *
 * - Built ONLY from authoritative database category fields (name, description) plus
 *   the trusted NEXT_PUBLIC_APP_URL base - never from query parameters, client input,
 *   bidder data, or payment identifiers
 * - Description falls back deterministically when the DB description is absent; copy
 *   makes no winner/#1/rank claims (the page does not verify ranking position)
 * - Canonical URL is the public category route itself
 *
 * Pure and deterministic: returns a Next.js Metadata object that the framework
 * serializes (no raw <meta>/<head> HTML is ever constructed here). No OG image is
 * produced - dynamic image generation is Task 7.6; share tracking is Task 7.7.
 */

const SITE_NAME = 'Topbid.lol';

function fallbackDescription(categoryName: string): string {
  return `Bid on ${categoryName} on Topbid.lol - place your bid to claim the top spot.`;
}

export function buildCategoryMetadata({
  category,
  baseUrl,
}: {
  category: Category;
  baseUrl: string;
}): Metadata {
  const base = baseUrl?.trim();

  if (!base) {
    throw new Error('Missing NEXT_PUBLIC_APP_URL: required to build category metadata');
  }

  const title = `${category.name} — ${SITE_NAME}`;
  const description = category.description?.trim() || fallbackDescription(category.name);
  const url = buildCategoryUrl(base, category.slug);

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}
