import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * UI redesign follow-up - navigation & Recent Bids regression tests.
 *
 * Pins two concrete fixes:
 * 1. The navbar "Categories" control is a REAL dropdown fed by the existing RLS-safe
 *    active-categories query, navigating through the canonical URL helper - no dead
 *    "/" link, no invented routes.
 * 2. Recent Bids no longer renders a "View all" control pointing at the nonexistent
 *    /bids route.
 */

const NAV_SOURCE = readFileSync(
  join(process.cwd(), 'src', 'components', 'NavbarCategories.tsx'),
  'utf8'
);
const NAVBAR_SOURCE = readFileSync(join(process.cwd(), 'src', 'components', 'Navbar.tsx'), 'utf8');
const RECENT_SOURCE = readFileSync(
  join(process.cwd(), 'src', 'components', 'RecentBids.tsx'),
  'utf8'
);

describe('navbar categories navigation (follow-up)', () => {
  it('uses the existing RLS-safe active-categories source', () => {
    expect(NAV_SOURCE).toContain('getActiveCategoryOptions');
    expect(NAV_SOURCE).toContain("from '@/lib/bids-client'");
  });

  it('navigates to homepage with category filter using window.location.href', () => {
    expect(NAV_SOURCE).toContain("window.location.href = '/'");
    expect(NAV_SOURCE).toContain('window.location.href = `/?category=${encodeURIComponent(slug)}`');
  });

  it('has accessible trigger semantics and dismiss behaviors', () => {
    expect(NAV_SOURCE).toContain('aria-expanded={open}');
    expect(NAV_SOURCE).toContain('aria-haspopup="true"');
    expect(NAV_SOURCE).toContain("event.key === 'Escape'");
    expect(NAV_SOURCE).toContain("'mousedown'"); // outside-click close
  });

  it('keeps the 44px touch-target standard on trigger and options', () => {
    expect(NAV_SOURCE.match(/min-h-11/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(NAV_SOURCE).not.toMatch(/min-h-(8|9|10)\b/);
  });

  it('both navbar variants mount the functional component', () => {
    expect(NAVBAR_SOURCE).toContain('<NavbarCategories variant="desktop" />');
    expect(NAVBAR_SOURCE).toContain('<NavbarCategories variant="mobile" />');
  });

  it('no navbar link targets the nonexistent /leaderboard route anymore', () => {
    expect(NAVBAR_SOURCE).not.toContain('href="/leaderboard"');
    // Leaderboard now deep-links to the Home section anchor that actually exists:
    expect(NAVBAR_SOURCE).toContain('/#leaderboard-heading');
  });
});

describe('recent bids "View all" removal (follow-up)', () => {
  it('no View all control remains in Recent Bids', () => {
    expect(RECENT_SOURCE).not.toContain('View all');
  });

  it('the nonexistent /bids href is gone from Recent Bids', () => {
    expect(RECENT_SOURCE).not.toContain('"/bids"');
    expect(RECENT_SOURCE).not.toContain("href='/bids'");
  });

  it('the Recent Bids list itself is unchanged (heading + live feed intact)', () => {
    expect(RECENT_SOURCE).toContain('id="recent-bids-heading"');
    expect(RECENT_SOURCE).toContain('Recent Bids');
    expect(RECENT_SOURCE).toContain('role="list"');
  });
});
