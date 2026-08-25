import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LEADERBOARD_PAGE_SIZE } from './LeaderboardTable';

/**
 * UI redesign task - console/leaderboard structural regression tests.
 *
 * The interactive components are client components without a DOM test environment in
 * this repository; these tests pin their SOURCE-LEVEL contract (the parts that
 * regressed historically): no manual price input anywhere, "Bid" label, 44px touch
 * targets, bounded pagination, and email-free leaderboard rows.
 */

const bidsClientMock = vi.hoisted(() => ({
  getLeaderboardPage: vi.fn(),
}));

vi.mock('@/lib/bids-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bids-client')>();

  return {
    ...actual,
    getLeaderboardPage: bidsClientMock.getLeaderboardPage,
  };
});

const CONSOLE_SOURCE = readFileSync(
  join(process.cwd(), 'src', 'components', 'BidConsole.tsx'),
  'utf8'
);
const TABLE_SOURCE = readFileSync(
  join(process.cwd(), 'src', 'components', 'LeaderboardTable.tsx'),
  'utf8'
);

describe('BidConsole structure (UI redesign task)', () => {
  it('input is the product URL / @handle field with the EXACT placeholder', () => {
    expect(CONSOLE_SOURCE).toContain('placeholder="Your product url or @handle"');
    expect(CONSOLE_SOURCE).toContain('label htmlFor="bid-console-product"');
  });

  it('has NO email input anywhere in the new bid console', () => {
    expect(CONSOLE_SOURCE).not.toMatch(/type=["']email["']/);
    expect(CONSOLE_SOURCE).not.toMatch(/autoComplete=["']email["']/i);
    expect(CONSOLE_SOURCE).not.toContain('bid-console-email');
    expect(CONSOLE_SOURCE.toLowerCase()).not.toContain('you@example.com');
  });

  it('has NO manual bid-amount input anywhere in the flow', () => {
    expect(CONSOLE_SOURCE).not.toMatch(/type=["']number["']/);
    const inputs = CONSOLE_SOURCE.match(/type="(email|text|number)"/g) ?? [];
    expect(inputs).toEqual(['type="text"']);
    expect(CONSOLE_SOURCE).not.toMatch(/bid-amount|bidAmount/i);
  });

  it('the primary button is labeled exactly "Bid"', () => {
    expect(CONSOLE_SOURCE).toContain("{pending ? 'Starting…' : 'Bid'}");
  });

  it('keeps the 44px touch-target standard on every control', () => {
    expect(CONSOLE_SOURCE).toContain('min-h-11'); // email input
    expect(CONSOLE_SOURCE).toContain('min-h-11 min-w-11'); // category icon
    expect(CONSOLE_SOURCE).not.toMatch(/min-h-(8|9|10)\b/);
  });

  it('opens the dropdown from the icon with listbox semantics', () => {
    expect(CONSOLE_SOURCE).toContain('aria-expanded={menuOpen}');
    expect(CONSOLE_SOURCE).toContain('aria-haspopup="listbox"');
    expect(CONSOLE_SOURCE).toContain('role="listbox"');
    expect(CONSOLE_SOURCE).toContain("'mousedown'");
    expect(CONSOLE_SOURCE).toContain("event.key === 'Escape'");
  });

  it('submits through submitBid and navigates to the returned Stripe URL', () => {
    expect(CONSOLE_SOURCE).toContain('submitBid');
    expect(CONSOLE_SOURCE).toContain('window.location.assign(outcome.url)');
  });

  it('offers an explicit unselected option targeting the global leader', () => {
    expect(CONSOLE_SOURCE).toContain('Leading category');
  });
});

describe('LeaderboardTable bounds & privacy (UI redesign task)', () => {
  beforeEach(() => {
    bidsClientMock.getLeaderboardPage.mockReset();
  });

  it('home server-renders page 1 from the authoritative query (bounded to the page size)', () => {
    const pageSource = readFileSync(join(process.cwd(), 'src', 'app', 'page.tsx'), 'utf8');

    expect(pageSource).toContain('getLeaderboard({ limit: LEADERBOARD_PAGE_SIZE })');
    expect(pageSource).toContain('<LeaderboardTable initialEntries={initialEntries} />');
  });

  it('shows a clear empty state when there are no paid bids yet', () => {
    expect(TABLE_SOURCE).toContain('No paid bids yet');
  });

  it('page size is ~50 and bounded', () => {
    expect(LEADERBOARD_PAGE_SIZE).toBeGreaterThanOrEqual(40);
    expect(LEADERBOARD_PAGE_SIZE).toBeLessThanOrEqual(60);
  });

  it('pagination fetches server-side ranges (never an unbounded client dataset)', () => {
    expect(TABLE_SOURCE).toContain('getLeaderboardPage(offset');

    const clientSource = readFileSync(join(process.cwd(), 'src', 'lib', 'bids-client.ts'), 'utf8');
    expect(clientSource).toMatch(/\.range\(offset/);
  });

  it('rows never render bidder emails - identity is name or anonymous', () => {
    expect(TABLE_SOURCE).toContain("entry.bidderName ?? 'Anonymous bidder'");
    expect(TABLE_SOURCE).not.toContain('bidderEmail');

    const pageSource = readFileSync(join(process.cwd(), 'src', 'app', 'page.tsx'), 'utf8');
    expect(pageSource).not.toContain('bidderEmail');
  });

  it('keeps the public share anchor target on the leaderboard section', () => {
    expect(TABLE_SOURCE).toContain('id="leaderboard-heading"');
  });

  it('paginated query itself excludes bidder_email from selection', () => {
    const clientSource = readFileSync(join(process.cwd(), 'src', 'lib', 'bids-client.ts'), 'utf8');
    const paginated = clientSource.slice(
      clientSource.indexOf('getLeaderboardPage'),
      clientSource.indexOf('export type CategoryOption')
    );

    expect(paginated).toContain('.range(offset');
    expect(paginated).not.toContain('bidder_email');
  });
});

describe('$500 fallback is eradicated from the bid flow (critical)', () => {
  // Matches a $500 default/fallback or a legacy starting-bid floor, while ignoring
  // unrelated numeric literals such as HTTP status 500.
  const FALLBACK_PATTERN = /\$500\b|=\s*500\b|amount[^;\n]{0,20}\b500\b|50_000|50000|starting_bid/;

  const FILES = [
    join(process.cwd(), 'src', 'lib', 'next-bid.ts'),
    join(process.cwd(), 'src', 'app', 'api', 'bids', 'checkout', 'route.ts'),
    join(process.cwd(), 'src', 'lib', 'bid-submit.ts'),
    join(process.cwd(), 'src', 'lib', 'checkout.ts'),
  ];

  it('no derivation/submit/checkout file contains a $500-style default or starting-bid floor', () => {
    const offenders = FILES.filter((file) => FALLBACK_PATTERN.test(readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('the first-bid amount is exactly $1 (100 cents) in the resolver and RPC rule docs', () => {
    expect(readFileSync(join(process.cwd(), 'src', 'lib', 'next-bid.ts'), 'utf8')).toContain(
      'FIRST_BID_CENTS = 100'
    );

    const migration = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '20260823000023_next_bid_one_dollar.sql'),
      'utf8'
    );
    expect(migration).toContain('v_first_bid constant integer := 100');
    expect(migration).toContain('v_step constant integer := 100');
  });
});
