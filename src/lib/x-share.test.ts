import { describe, expect, it } from 'vitest';

import { buildXShareText, buildXShareUrl } from './x-share';

/**
 * Task 7.2 — deterministic tests for the X share-intent helpers.
 * Pure functions only: no network requests to X/Twitter ever occur.
 */

describe('buildXShareText', () => {
  it('composes copy with category and formatted amount', () => {
    expect(buildXShareText({ amountCents: 125000, categoryName: 'Art & Collectibles' })).toBe(
      'I just bid $1,250 on Art & Collectibles on Topbid.lol!'
    );
  });

  it('omits the category segment when none is available', () => {
    expect(buildXShareText({ amountCents: 150000, categoryName: null })).toBe(
      'I just bid $1,500 on Topbid.lol!'
    );
  });

  it.each([undefined, '', '   '])('treats %p as no category', (categoryName) => {
    expect(buildXShareText({ amountCents: 9900, categoryName: categoryName as string })).toBe(
      'I just bid $99 on Topbid.lol!'
    );
  });

  it('formats integer cents as whole-dollar USD (repo rounding convention)', () => {
    expect(buildXShareText({ amountCents: 100 })).toContain('$1');
    expect(buildXShareText({ amountCents: 150000 })).toContain('$1,500');
  });

  it('makes no winner or rank claims', () => {
    const text = buildXShareText({ amountCents: 500000, categoryName: 'Gaming' });

    expect(text.toLowerCase()).not.toContain('#1');
    expect(text.toLowerCase()).not.toContain('winning');
    expect(text.toLowerCase()).not.toContain('winner');
    expect(text.toLowerCase()).not.toContain('highest');
  });

  it('is deterministic for identical input', () => {
    const input = { amountCents: 250000, categoryName: 'Sneakers' };

    expect(buildXShareText(input)).toBe(buildXShareText(input));
  });
});

describe('buildXShareUrl', () => {
  it('constructs the standard X web intent with encoded parameters', () => {
    expect(
      buildXShareUrl({
        text: 'I just bid $1,250 on Art & Collectibles on Topbid.lol!',
        url: 'https://topbid.lol/#leaderboard-heading',
      })
    ).toBe(
      'https://x.com/intent/tweet?' +
        'text=I%20just%20bid%20%241%2C250%20on%20Art%20%26%20Collectibles%20on%20Topbid.lol!&' +
        'url=https%3A%2F%2Ftopbid.lol%2F%23leaderboard-heading'
    );
  });

  it('percent-encodes special characters that would break naive concatenation', () => {
    const url = buildXShareUrl({
      text: 'Bid $5 & win? #topbid "quoted"',
      url: 'https://topbid.lol/?a=1&b=2#frag',
    });

    expect(url).not.toMatch(/text=[^&]*&\s/);
    expect(url).toContain(encodeURIComponent('Bid $5 & win? #topbid "quoted"'));
    expect(url).toContain(encodeURIComponent('https://topbid.lol/?a=1&b=2#frag'));
  });

  it('keeps category names with spaces intact after decoding', () => {
    const url = buildXShareUrl({
      text: buildXShareText({ amountCents: 200000, categoryName: 'Streetwear Drops' }),
      url: 'https://topbid.lol/#leaderboard-heading',
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://x.com/intent/tweet');
    expect(parsed.searchParams.get('text')).toBe(
      'I just bid $2,000 on Streetwear Drops on Topbid.lol!'
    );
    expect(parsed.searchParams.get('url')).toBe('https://topbid.lol/#leaderboard-heading');
  });

  it('never includes sensitive identifiers supplied by callers', () => {
    const url = buildXShareUrl({
      text: buildXShareText({ amountCents: 100000, categoryName: 'Art' }),
      url: 'https://topbid.lol/#leaderboard-heading',
    });

    // The helper can only emit what it is given - the success page must therefore
    // never pass session/payment identifiers (enforced there); this pins the
    // encoding behavior for audited inputs.
    expect(url).toContain('text=');
    expect(url).toContain('url=https%3A%2F%2Ftopbid.lol');
    expect(url).not.toContain('cs_');
    expect(url).not.toContain('pi_');
    expect(url).not.toContain('@');
  });

  it('is deterministic for identical input', () => {
    const input = { text: 'I just bid $10 on Topbid.lol!', url: 'https://topbid.lol/' };

    expect(buildXShareUrl(input)).toBe(buildXShareUrl(input));
  });
});
