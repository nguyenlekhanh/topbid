import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import robots from './robots';

/**
 * Task 10.5 - robots.txt policy tests.
 *
 * The generator must keep every private/non-SEO surface out of crawlers while
 * advertising the sitemap location built from the single trusted origin
 * (NEXT_PUBLIC_APP_URL), and must never throw when that origin is unconfigured.
 */

function stubAppUrl(value: string | undefined) {
  if (value === undefined) {
    vi.unstubAllEnvs();
  } else {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', value);
  }
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://topbid.lol');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('robots generator (Task 10.5)', () => {
  it('allows crawling and blocks every private/non-SEO prefix', () => {
    const result = robots();

    expect(result.rules).toEqual([
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/api', '/success', '/cancel', '/unsubscribe'],
      },
    ]);
  });

  it('advertises the sitemap on the configured production origin', () => {
    expect(robots().sitemap).toBe('https://topbid.lol/sitemap.xml');
  });

  it('normalizes trailing slashes on the configured origin', () => {
    stubAppUrl('https://topbid.lol/');

    expect(robots().sitemap).toBe('https://topbid.lol/sitemap.xml');
  });

  it('emits rules without a sitemap reference when no origin is configured', () => {
    stubAppUrl(undefined);

    const result = robots();

    expect(result.rules).toHaveLength(1);
    expect(result.sitemap).toBeUndefined();
  });
});
