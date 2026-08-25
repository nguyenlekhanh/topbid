import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Task 10.6 - PublicAnalytics mount tests.
 *
 * Renders the real client component server-side with the provider and router mocked,
 * proving that the Vercel Analytics script is mounted ONLY on public paths and never
 * on private surfaces - independent of any browser environment.
 */

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  Analytics: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
}));

// The real Analytics component injects scripts; replace it with a marker element so
// static markup assertions stay deterministic.
vi.mock('@vercel/analytics/react', () => {
  const FakeAnalytics = () => createElement('div', { 'data-testid': 'vercel-analytics' });

  return { Analytics: FakeAnalytics };
});

import PublicAnalytics from './PublicAnalytics';

beforeEach(() => {
  mocks.usePathname.mockReset();
});

describe('PublicAnalytics mount (Task 10.6)', () => {
  it.each([['/'], ['/categories/art'], ['/categories/weird%20%26%20slug']])(
    'mounts analytics on public path %p',
    (path) => {
      mocks.usePathname.mockReturnValue(path);

      const html = renderToStaticMarkup(createElement(PublicAnalytics));

      expect(html).toContain('data-testid="vercel-analytics"');
    }
  );

  it.each([
    ['/admin'],
    ['/admin/login'],
    ['/api/share-events'],
    ['/success'],
    ['/cancel'],
    ['/unsubscribe'],
  ])('renders nothing on private path %p', (path) => {
    mocks.usePathname.mockReturnValue(path);

    const html = renderToStaticMarkup(createElement(PublicAnalytics));

    expect(html).not.toContain('vercel-analytics');
    expect(html).toBe('');
  });

  it('fails closed to not-tracked when the pathname is unavailable', () => {
    mocks.usePathname.mockReturnValue(null);

    const html = renderToStaticMarkup(createElement(PublicAnalytics));

    expect(html).toBe('');
  });
});
