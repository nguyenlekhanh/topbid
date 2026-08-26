import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * UI redesign follow-up - Recent Bids regression tests.
 * The dead "View all" control (nonexistent /bids route) must stay removed while the
 * live feed itself remains intact.
 */

const RECENT_SOURCE = readFileSync(
  join(process.cwd(), 'src', 'components', 'RecentBids.tsx'),
  'utf8'
);

describe('Recent Bids surface (follow-up)', () => {
  it('no View all control exists', () => {
    expect(RECENT_SOURCE).not.toContain('View all');
  });

  it('the nonexistent /bids href is gone', () => {
    expect(RECENT_SOURCE).not.toContain('"/bids"');
  });

  it('the live feed itself is unchanged', () => {
    expect(RECENT_SOURCE).toContain('id="recent-bids-heading"');
    expect(RECENT_SOURCE).toContain('role="list"');
    expect(RECENT_SOURCE).toContain('getRecentBidEntries');
  });
});
