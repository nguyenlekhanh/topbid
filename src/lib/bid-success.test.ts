import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractSessionId, resolveBidSuccessView } from './bid-success';
import type { BidWithCategory } from './bids';

/**
 * Task 7.1 — deterministic tests for the bid success page's decision logic.
 * Pure functions only: no DOM, no database, no Stripe, no network.
 */

const CATEGORY = { id: 'cat-1', slug: 'art', name: 'Art & Collectibles' };

const PAID_BID = {
  id: 'bid-1',
  category_id: 'cat-1',
  amount: 125000,
  bidder_email: 'winner@example.com',
  bidder_name: 'Winner',
  stripe_session_id: 'cs_test_abc',
  stripe_payment_intent_id: 'pi_123',
  status: 'paid',
  is_highest: true,
  created_at: '2026-08-24T00:00:00Z',
  paid_at: '2026-08-24T00:00:00Z',
  entry_title: null,
  entry_description: null,
  entry_canonical_url: null,
  entry_image_url: null,
  entry_favicon_url: null,
  entry_type: null,
};

const LOOKUP: BidWithCategory = { bid: PAID_BID, category: CATEGORY };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractSessionId', () => {
  it('accepts a single string session identifier', () => {
    expect(extractSessionId({ session_id: 'cs_test_abc' })).toBe('cs_test_abc');
  });

  it('trims surrounding whitespace', () => {
    expect(extractSessionId({ session_id: '  cs_test_abc  ' })).toBe('cs_test_abc');
  });

  it.each([undefined, null, ['cs_one', 'cs_two'], ['cs_only'], 42, {}, '', '   ', 'x'.repeat(256)])(
    'rejects unusable value %p without throwing',
    (value) => {
      expect(extractSessionId({ session_id: value as never })).toBeNull();
    }
  );

  it('tolerates records without the key entirely', () => {
    expect(extractSessionId({})).toBeNull();
    expect(extractSessionId({ other: 'value' })).toBeNull();
  });

  it('accepts an identifier at the maximum length boundary', () => {
    const maxId = 'x'.repeat(255);
    expect(extractSessionId({ session_id: maxId })).toBe(maxId);
  });
});

describe('resolveBidSuccessView', () => {
  it('maps a paid lookup to the confirmed view with DB-sourced values only', () => {
    expect(resolveBidSuccessView('cs_test_abc', LOOKUP)).toEqual({
      view: 'confirmed',
      amountCents: 125000,
      categoryName: 'Art & Collectibles',
      reference: 'cs_test_abc',
    });
  });

  it('falls back gracefully when the embedded category is unreadable', () => {
    const view = resolveBidSuccessView('cs_test_abc', { bid: PAID_BID, category: null });

    expect(view).toEqual({
      view: 'confirmed',
      amountCents: 125000,
      categoryName: null,
      reference: 'cs_test_abc',
    });
  });

  it.each([
    ['missing identifier', null],
    ['blank identifier', '   '],
  ])('renders awaiting with no reference for %p', (_label, sessionId) => {
    expect(resolveBidSuccessView(sessionId as string | null, LOOKUP)).toEqual({
      view: 'awaiting',
      reference: null,
    });
  });

  it('renders awaiting when no bid is visible for the session (pending/unknown under RLS)', () => {
    expect(resolveBidSuccessView('cs_unknown', null)).toEqual({
      view: 'awaiting',
      reference: 'cs_unknown',
    });
  });

  it('truncates the sanitized reference echo to 64 characters', () => {
    const longId = 'y'.repeat(200);

    expect(resolveBidSuccessView(longId, null)).toEqual({
      view: 'awaiting',
      reference: 'y'.repeat(64),
    });
  });

  it('never lets client data masquerade as confirmed state', () => {
    // A session id alone - however well-formed - cannot produce a confirmed view
    // without the authoritative paid-bid lookup backing it.
    const confirmedOnlyViaLookup = resolveBidSuccessView('cs_test_abc', LOOKUP);
    const idAlone = resolveBidSuccessView('cs_test_abc', null);

    expect(confirmedOnlyViaLookup.view).toBe('confirmed');
    expect(idAlone.view).toBe('awaiting');
  });

  it('passes amounts through unmodified integer cents for page-side formatting', () => {
    const view = resolveBidSuccessView('cs_test_abc', {
      bid: { ...PAID_BID, amount: 100 },
      category: CATEGORY,
    });

    expect(view.view === 'confirmed' && view.amountCents).toBe(100);
  });
});
