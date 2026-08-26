import { describe, expect, it } from 'vitest';

import { extractProductMetadata } from './product-resolver';

const BASE = 'https://voxylio.lndev.me';

describe('extractProductMetadata (UI redesign follow-up)', () => {
  it('prefers Open Graph fields and canonical URL', () => {
    const meta = extractProductMetadata(
      [
        '<html><head>',
        '<title>HTML fallback title</title>',
        '<meta name="description" content="meta description text">',
        '<link rel="canonical" href="https://voxylio.lndev.me/canonical">',
        '<meta property="og:title" content="Voxylio — Real-time video dubbing in your browser">',
        '<meta property="og:description" content="A Chrome extension that dubs any subtitled video in real time.">',
        '<meta property="og:image" content="/og-image.png">',
        '<meta property="og:site_name" content="Voxylio">',
        '<link rel="icon" href="/favicon.ico">',
        '</head></html>',
      ].join(''),
      BASE
    );

    expect(meta.canonicalUrl).toBe('https://voxylio.lndev.me/canonical');
    expect(meta.title).toBe('Voxylio — Real-time video dubbing in your browser');
    expect(meta.description).toBe('A Chrome extension that dubs any subtitled video in real time.');
    expect(meta.imageUrl).toBe('https://voxylio.lndev.me/og-image.png');
    expect(meta.faviconUrl).toBe('https://voxylio.lndev.me/favicon.ico');
    expect(meta.siteName).toBe('Voxylio');
  });

  it('falls back to <title> / meta description when OG is missing', () => {
    const meta = extractProductMetadata(
      '<html><head><title>   Plain page   </title><meta name="description" content="  desc here  "></head></html>',
      `${BASE}/page`
    );

    expect(meta.title).toBe('Plain page');
    expect(meta.description).toBe('desc here');
  });

  it('uses twitter:image when og:image is absent', () => {
    const meta = extractProductMetadata(
      '<html><head><meta name="twitter:image" content="/tw.png"></head></html>',
      BASE
    );

    expect(meta.imageUrl).toBe(`${BASE}/tw.png`);
  });

  it('resolves relative icon/canonical/image URLs against the page URL', () => {
    const meta = extractProductMetadata(
      '<html><head><link rel="apple-touch-icon" href="/icons/touch.png"></head></html>',
      `${BASE}/product/foo`
    );

    expect(meta.faviconUrl).toBe(`${BASE}/icons/touch.png`);
  });

  it('falls back favicon to /favicon.ico of the origin', () => {
    const meta = extractProductMetadata('<html><head></head></html>', BASE);

    expect(meta.faviconUrl).toBe(`${BASE}/favicon.ico`);
    expect(meta.siteName).toBe('voxylio.lndev.me'); // hostname minus www
  });

  it('decodes HTML entities in titles/descriptions', () => {
    const meta = extractProductMetadata(
      '<html><head><meta property="og:title" content="Tom &amp; Jerry &#39;live&#39;"></head></html>',
      BASE
    );

    expect(meta.title).toBe("Tom & Jerry 'live'");
  });

  it('never returns raw HTML/script content as a field value', () => {
    const meta = extractProductMetadata(
      '<html><head><script>alert(1)</script><title>Safe</title></head></html>',
      BASE
    );

    expect(JSON.stringify(meta)).not.toContain('<script>');
  });
});
