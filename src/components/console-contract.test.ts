import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

/**
 * UI redesign task + follow-ups - console structural contract tests.
 *
 * The interactive components are client components without a DOM test environment in
 * this repository; these tests pin their SOURCE-LEVEL contract (the parts that
 * regressed historically): no manual price input anywhere, no email field, "Bid"
 * label, 44px touch targets, the local two-column entry/forecast preview, and the
 * checkout submit path.
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

describe('BidConsole structure (UI redesign task)', () => {
  it('has NO manual bid-amount input anywhere in the flow', () => {
    expect(CONSOLE_SOURCE).not.toMatch(/type=["']number["']/);
    const inputs = CONSOLE_SOURCE.match(/type="(email|text|number|url)"/g) ?? [];
    expect(inputs).toEqual(['type="text"']);
    expect(CONSOLE_SOURCE.toLowerCase()).not.toContain('bidamount');
  });

  it('has NO email input anywhere in the new bid console', () => {
    expect(CONSOLE_SOURCE).not.toMatch(/type=["']email["']/);
    expect(CONSOLE_SOURCE.toLowerCase()).not.toContain('you@example.com');
    expect(CONSOLE_SOURCE).not.toContain('bid-console-email');
  });

  it('the primary button is labeled exactly "Bid"', () => {
    expect(CONSOLE_SOURCE).toContain("{pending ? 'Starting…' : 'Bid'}");
  });

  it('keeps the 44px touch-target standard on every control', () => {
    expect(CONSOLE_SOURCE).toContain('min-h-11'); // product input
    expect(CONSOLE_SOURCE).toContain('min-h-11 min-w-11'); // category icon
    expect(CONSOLE_SOURCE).not.toMatch(/min-h-(8|9|10)\b/);
  });

  it('opens the category dropdown from the icon with listbox semantics', () => {
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

describe('entry preview + position forecast structure (follow-up)', () => {
  it('renders the two-column preview only for non-empty input', () => {
    expect(CONSOLE_SOURCE).toContain('data-testid="entry-preview"');
    expect(CONSOLE_SOURCE).toMatch(/product\.trim\(\) \? \(/);
  });

  it('LEFT column shows the exact identifier and the verified-entry copy', () => {
    expect(CONSOLE_SOURCE).toContain('data-testid="preview-identifier"');
    expect(CONSOLE_SOURCE).toContain('{product.trim()}');
    expect(CONSOLE_SOURCE).toContain('Verified public entry.');
  });

  it('RIGHT column is a database-derived POSITION FORECAST', () => {
    expect(CONSOLE_SOURCE).toContain('Position forecast');
    expect(CONSOLE_SOURCE).toContain('Projected #');
    expect(CONSOLE_SOURCE).toContain('on the live board');
    expect(CONSOLE_SOURCE).toContain('/api/bids/forecast');
    expect(CONSOLE_SOURCE).toContain("searchParams.set('category', selected.slug)");
  });

  it('does NOT perform external URL resolution from the console anymore', () => {
    expect(CONSOLE_SOURCE).not.toContain('/api/products/resolve');
    expect(CONSOLE_SOURCE).not.toContain('resolveProductPreview');
  });

  it('forecast failures never block bidding', () => {
    expect(CONSOLE_SOURCE).toContain('bidding still works.');
  });
});

describe('checkout & authority invariants preserved (follow-up)', () => {
  it('still submits to /api/bids/checkout with identity + optional category only', () => {
    const submitSource = readFileSync(join(process.cwd(), 'src', 'lib', 'bid-submit.ts'), 'utf8');

    expect(submitSource).toContain("'/api/bids/checkout'");
    expect(submitSource).toContain('product: input.product.trim()');
    expect(JSON.stringify(submitSource)).not.toContain('amountCents');
  });
});
