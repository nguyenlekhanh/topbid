import { describe, expect, it } from 'vitest';

import { OG_IMAGE_SIZE, buildOgImageContent } from './category-og-image';

/**
 * Task 7.6 — deterministic tests for the dynamic OG image content model.
 * Pure functions only: satori/ImageResponse rendering is exercised by the framework
 * route; these tests pin every data decision the rendered pixels depend on.
 */

const BASE_INPUT = {
  categoryName: 'Art & Collectibles',
  categoryDescription: 'Rare artwork, sculptures, and limited edition collectibles.',
  startingBidCents: 50000,
  highestPaidBidCents: null as number | null,
};

describe('OG image size', () => {
  it('uses the standard social-preview dimensions', () => {
    expect(OG_IMAGE_SIZE).toEqual({ width: 1200, height: 630 });
  });
});

describe('buildOgImageContent — amount state', () => {
  it('labels the highest PAID bid as the current highest bid when present', () => {
    const content = buildOgImageContent({
      ...BASE_INPUT,
      highestPaidBidCents: 125000,
    });

    expect(content.amountLabel).toBe('Current highest bid');
    expect(content.amountText).toBe('$1,250');
  });

  it('falls back to the authoritative starting bid with a distinct label when no paid bids exist', () => {
    const content = buildOgImageContent(BASE_INPUT);

    expect(content.amountLabel).toBe('Starting bid');
    expect(content.amountText).toBe('$500');
  });

  it('never treats pending amounts as the highest paid bid (loader only surfaces paid)', () => {
    // The loader cannot return pending bids; this pins that absent-paid renders the
    // starting-bid label rather than any bid-like claim.
    const content = buildOgImageContent(BASE_INPUT);

    expect(content.amountLabel).not.toBe('Current highest bid');
    expect(content.heading).toBe('Art & Collectibles');
  });

  it('renders whole-dollar USD amounts deterministically', () => {
    const content = buildOgImageContent({
      ...BASE_INPUT,
      highestPaidBidCents: 100000,
    });

    expect(content.amountText).toBe('$1,000');
  });
});

describe('buildOgImageContent — text safety and truncation', () => {
  it('truncates very long category names on a single deterministic boundary', () => {
    const content = buildOgImageContent({
      ...BASE_INPUT,
      categoryName: 'A'.repeat(200),
    });

    expect(content.heading).toHaveLength(60);
    expect(content.heading.endsWith('…')).toBe(true);
  });

  it('keeps names within the length limit intact when short enough', () => {
    const content = buildOgImageContent({ ...BASE_INPUT, categoryName: 'Gaming' });

    expect(content.heading).toBe('Gaming');
  });

  it('truncates long descriptions to the preview-safe limit', () => {
    const content = buildOgImageContent({
      ...BASE_INPUT,
      categoryDescription: 'd'.repeat(300),
    });

    expect(content.tagline).toHaveLength(120);
    expect(content.tagline?.endsWith('…')).toBe(true);
  });

  it('omits the tagline entirely for blank/absent descriptions', () => {
    expect(buildOgImageContent({ ...BASE_INPUT, categoryDescription: null }).tagline).toBeNull();
    expect(buildOgImageContent({ ...BASE_INPUT, categoryDescription: '   ' }).tagline).toBeNull();
  });

  it('carries database text verbatim (framework escapes rendering; no manual HTML)', () => {
    const content = buildOgImageContent({
      ...BASE_INPUT,
      categoryName: '<script>alert("x")</script>',
    });

    // The raw text passes through untouched - satori renders it as inert glyphs.
    expect(content.heading).toContain('<script>');
  });
});

describe('buildOgImageContent — branding and privacy', () => {
  it('always includes recognizable Topbid.lol branding', () => {
    expect(buildOgImageContent(BASE_INPUT).brand).toBe('Topbid.lol');
  });

  it('exposes no fields that could carry emails, session ids, or tokens', () => {
    const content = buildOgImageContent(BASE_INPUT);
    const serialized = JSON.stringify(content);

    expect(serialized).not.toContain('@');
    expect(serialized).not.toContain('cs_');
    expect(serialized).not.toContain('pi_');
    expect(serialized).not.toContain('token');
  });

  it('is deterministic for identical input', () => {
    expect(buildOgImageContent(BASE_INPUT)).toEqual(buildOgImageContent(BASE_INPUT));
  });
});
