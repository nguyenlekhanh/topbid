import { ImageResponse } from 'next/og';

import { loadCategoryPageData } from '@/lib/category-page';
import { OG_IMAGE_SIZE, buildOgImageContent } from '@/lib/category-og-image';

export const contentType = 'image/png';
export const size = OG_IMAGE_SIZE;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Dynamic Open Graph image for public category pages (Task 7.6).
 *
 * - Framework-native opengraph-image convention: Next.js automatically attaches this
 *   image to the route's og:image/twitter:image metadata (Task 7.5 fields untouched)
 * - Runtime nodejs: reuses the exact Supabase server query path
 *   (loadCategoryPageData -> getCategoryBySlug active-only under RLS + paid-only
 *   highest bid) instead of duplicating SQL; edge offers no benefit here and Node is
 *   the proven path for every existing route
 * - force-dynamic: the image embeds leaderboard-changing data, so it renders per
 *   request rather than being statically cached; no custom invalidation system
 * - Unresolvable slugs render a neutral brand-only card containing NO category data -
 *   identical to the page's no-existence-leak boundary
 * - Text renders through satori text primitives only; database strings are never
 *   injected as markup. No fonts are fetched at runtime (satori default font), so the
 *   route stays reliable on Vercel without network dependencies
 */

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await loadCategoryPageData(slug);

  if (!data) {
    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          color: '#ffffff',
          fontSize: 64,
          fontWeight: 700,
        }}
      >
        Topbid.lol
      </div>,
      size
    );
  }

  const content = buildOgImageContent({
    categoryName: data.category.name,
    categoryDescription: data.category.description,
    startingBidCents: data.category.starting_bid,
    highestPaidBidCents: data.highestBid ? data.highestBid.amount : null,
  });

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        background: 'linear-gradient(135deg, #ffffff 0%, #f5f5f5 100%)',
        color: '#0a0a0a',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, letterSpacing: '-0.02em' }}>
        {content.brand}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1 }}>{content.heading}</div>
        {content.tagline && (
          <div style={{ marginTop: 16, fontSize: 32, color: '#737373' }}>{content.tagline}</div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          borderTop: '2px solid #e5e5e5',
          paddingTop: 32,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 28, color: '#737373' }}>{content.amountLabel}</div>
          <div style={{ fontSize: 88, fontWeight: 700, lineHeight: 1.05 }}>
            {content.amountText}
          </div>
        </div>
        <div style={{ fontSize: 28, color: '#737373' }}>topbid.lol</div>
      </div>
    </div>,
    size
  );
}
