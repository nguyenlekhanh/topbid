import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import ProductPreviewCard, { type PreviewState } from './ProductPreviewCard';
import type { ProductPreview } from '@/lib/product-resolver';

/**
 * UI redesign follow-up - preview card state tests.
 * Every state renders deterministically; output exposes ONLY whitelisted metadata.
 */

const PREVIEW: ProductPreview = {
  sourceUrl: 'https://voxylio.lndev.me',
  canonicalUrl: 'https://voxylio.lndev.me/canonical',
  title: 'Voxylio — Real-time video dubbing in your browser',
  description: 'A Chrome extension that dubs any subtitled video in real time.',
  imageUrl: 'https://voxylio.lndev.me/og.png',
  faviconUrl: 'https://voxylio.lndev.me/favicon.ico',
  siteName: 'Voxylio',
};

function markup(state: PreviewState): string {
  return renderToStaticMarkup(createElement(ProductPreviewCard, { state }));
}

describe('ProductPreviewCard states (UI redesign follow-up)', () => {
  it('renders nothing in the idle state', () => {
    expect(markup({ kind: 'idle' })).toBe('');
  });

  it('shows a loading status', () => {
    const html = markup({ kind: 'loading' });

    expect(html).toContain('Resolving product');
    expect(html).toContain('role="status"');
  });

  it('shows a friendly error for unsafe urls (no internals)', () => {
    const html = markup({ kind: 'error', message: 'unsafe_url' });

    expect(html).toContain('private or unsafe address');
  });

  it('maps timeout failures to a retry hint', () => {
    const html = markup({ kind: 'error', message: 'timeout' });

    expect(html).toContain('took too long');
  });

  it('shows the exact unsupported-handle message for @handles', () => {
    const html = markup({ kind: 'unsupported_handle' }).replace(/&#x27;/g, "'");

    expect(html).toContain("This handle format isn't supported yet. Enter a product URL instead.");
  });

  it('renders title, description, canonical link and image on success', () => {
    const html = markup({ kind: 'resolved', preview: PREVIEW });

    expect(html).toContain('Voxylio — Real-time video dubbing in your browser');
    expect(html).toContain('A Chrome extension that dubs any subtitled video in real time.');
    expect(html).toContain('https://voxylio.lndev.me/favicon.ico');
    expect(html).toContain('https://voxylio.lndev.me/og.png');
    expect(html).toContain('href="https://voxylio.lndev.me/canonical"');
  });

  it('falls back to site name / canonical url when no title exists', async () => {
    const { resolveProductPreview } = await import('@/lib/product-resolver');
    void resolveProductPreview;

    const minimal: ProductPreview = {
      ...PREVIEW,
      title: null,
      description: null,
      imageUrl: null,
      faviconUrl: null,
      siteName: null,
    };

    const html = markup({ kind: 'resolved', preview: minimal });

    expect(html).toContain(PREVIEW.canonicalUrl);
    expect(html).not.toContain('<img');
  });
});
