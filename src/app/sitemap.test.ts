import { beforeEach, describe, expect, it, vi } from 'vitest';

import sitemap from './sitemap';

/**
 * Task 10.5 - sitemap.xml content tests.
 *
 * The sitemap must contain ONLY legitimate public/indexable URLs - the homepage plus
 * ACTIVE categories from the same RLS-safe query the public pages use. No session ids,
 * tokens, payment identifiers, admin routes, or API routes may ever appear, and
 * inactive/missing categories must be impossible to list.
 */

const listCategoriesMock = vi.hoisted(() => ({
  listCategories: vi.fn(),
}));

vi.mock('@/lib/categories', () => ({
  listCategories: listCategoriesMock.listCategories,
}));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://topbid.lol');
  listCategoriesMock.listCategories.mockReset();
});

describe('sitemap generator (Task 10.5)', () => {
  it('lists the homepage and every active category on the configured origin', async () => {
    listCategoriesMock.listCategories.mockResolvedValue([
      { id: 'c1', slug: 'art', is_active: true },
      { id: 'c2', slug: 'tech', is_active: true },
    ]);

    await expect(sitemap()).resolves.toEqual([
      { url: 'https://topbid.lol/' },
      { url: 'https://topbid.lol/categories/art' },
      { url: 'https://topbid.lol/categories/tech' },
    ]);
  });

  it('percent-encodes category slugs through the shared canonical helper', async () => {
    listCategoriesMock.listCategories.mockResolvedValue([
      { id: 'c1', slug: 'weird & space slug', is_active: true },
    ]);

    const result = await sitemap();

    expect(result).toEqual([
      { url: 'https://topbid.lol/' },
      { url: 'https://topbid.lol/categories/weird%20%26%20space%20slug' },
    ]);
    expect(JSON.stringify(result)).not.toContain('weird & space');
  });

  it('never includes private surfaces regardless of category data', async () => {
    listCategoriesMock.listCategories.mockResolvedValue([{ id: 'c1', slug: 'art' }]);

    const serialized = JSON.stringify(await sitemap());

    for (const forbidden of ['/success', '/cancel', '/unsubscribe', '/admin', '/api']) {
      expect(serialized).not.toContain(`"${forbidden}`);
      expect(serialized).not.toContain(`${forbidden}?`);
    }
  });

  it('serves homepage-only when the origin is unconfigured (no crash)', async () => {
    vi.unstubAllEnvs();
    listCategoriesMock.listCategories.mockResolvedValue([{ id: 'c1', slug: 'art' }]);

    await expect(sitemap()).resolves.toEqual([]);
    expect(listCategoriesMock.listCategories).not.toHaveBeenCalled();
  });

  it('degrades to the homepage when the database cannot be reached', async () => {
    listCategoriesMock.listCategories.mockRejectedValue(
      new Error('Failed to list categories: db down')
    );

    await expect(sitemap()).resolves.toEqual([{ url: 'https://topbid.lol/' }]);
  });
});
