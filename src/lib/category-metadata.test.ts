import { describe, expect, it } from 'vitest';

import { buildCategoryMetadata } from './category-metadata';
import type { Category } from './categories';

/**
 * Task 7.5 — deterministic tests for category Open Graph metadata construction.
 * Pure functions only: no database, no network, no rendering.
 */

const CATEGORY: Category = {
  id: 'cat-1',
  slug: 'art',
  name: 'Art & Collectibles',
  description: 'Rare artwork, sculptures, and limited edition collectibles.',
  starting_bid: 50000,
  increment: 5000,
  image_url: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const BASE = 'https://topbid.lol';

describe('buildCategoryMetadata', () => {
  it('builds title/description from authoritative category fields', () => {
    const metadata = buildCategoryMetadata({ category: CATEGORY, baseUrl: BASE });

    expect(metadata.title).toBe('Art & Collectibles — Topbid.lol');
    expect(metadata.description).toBe(CATEGORY.description);
  });

  it('sets the canonical URL to the public category route', () => {
    const metadata = buildCategoryMetadata({ category: CATEGORY, baseUrl: BASE });

    expect(metadata.alternates?.canonical).toBe('https://topbid.lol/categories/art');
    expect((metadata.openGraph as { url?: string }).url).toBe('https://topbid.lol/categories/art');
  });

  it('includes site name and website type in Open Graph data', () => {
    const metadata = buildCategoryMetadata({ category: CATEGORY, baseUrl: BASE });

    expect(metadata.openGraph).toMatchObject({
      title: 'Art & Collectibles — Topbid.lol',
      description: CATEGORY.description,
      siteName: 'Topbid.lol',
      type: 'website',
    });
  });

  it('uses a deterministic fallback description when the DB description is absent', () => {
    const metadata = buildCategoryMetadata({
      category: { ...CATEGORY, description: null },
      baseUrl: BASE,
    });

    expect(metadata.description).toBe(
      'Bid on Art & Collectibles on Topbid.lol - place your bid to claim the top spot.'
    );
  });

  it.each([undefined, '', '   '])('treats %p description as absent', (description) => {
    const metadata = buildCategoryMetadata({
      category: { ...CATEGORY, description: description as string },
      baseUrl: BASE,
    });

    expect(metadata.description).toContain('place your bid');
  });

  it('percent-encodes slugs with special characters in the canonical URL', () => {
    const metadata = buildCategoryMetadata({
      category: { ...CATEGORY, slug: 'art & gems' },
      baseUrl: BASE,
    });

    expect(metadata.alternates?.canonical).toBe('https://topbid.lol/categories/art%20%26%20gems');
  });

  it('normalizes trailing slashes on the base URL', () => {
    const metadata = buildCategoryMetadata({
      category: CATEGORY,
      baseUrl: 'https://topbid.lol/',
    });

    expect(metadata.alternates?.canonical).toBe('https://topbid.lol/categories/art');
  });

  it('never contains payment/session/bidder identifiers or unsubscribe tokens', () => {
    const serialized = JSON.stringify(buildCategoryMetadata({ category: CATEGORY, baseUrl: BASE }));

    expect(serialized).not.toContain('cs_test_abc');
    expect(serialized).not.toContain('session_id');
    expect(serialized).not.toContain('pi_');
    expect(serialized).not.toContain('bidder@example.com');
    expect(serialized).not.toContain('/unsubscribe?token=');
  });

  it('makes no winner or rank claims', () => {
    const serialized = JSON.stringify(buildCategoryMetadata({ category: CATEGORY, baseUrl: BASE }));

    const lowered = serialized.toLowerCase();
    expect(lowered).not.toContain('#1');
    expect(lowered).not.toContain('"winner"');
    expect(lowered).not.toContain('highest bidder');
  });

  it('throws descriptively when the base URL is not configured', () => {
    expect(() => buildCategoryMetadata({ category: CATEGORY, baseUrl: '' })).toThrow(
      'Missing NEXT_PUBLIC_APP_URL: required to build category metadata'
    );
  });

  it('is deterministic for identical input', () => {
    const input = { category: CATEGORY, baseUrl: BASE };

    expect(buildCategoryMetadata(input)).toEqual(buildCategoryMetadata(input));
  });
});
