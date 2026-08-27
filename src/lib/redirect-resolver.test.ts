import { describe, expect, it } from 'vitest';

import {
  resolveRedirectDestination,
  type BidRedirectMetadata,
  getFallbackUrl,
} from './redirect-resolver';

describe('resolveRedirectDestination', () => {
  const baseBid: BidRedirectMetadata = {
    id: 'test-bid-1',
    status: 'paid',
    entry_type: null,
    entry_canonical_url: null,
    entry_title: null,
  };

  describe('paid URL bids', () => {
    it('redirects to canonical URL for paid URL bid with https', () => {
      const bid: BidRedirectMetadata = {
        ...baseBid,
        entry_type: 'url',
        entry_canonical_url: 'https://walmart.com/',
      };

      const result = resolveRedirectDestination(bid);

      expect(result).toEqual({ ok: true, destination: 'https://walmart.com/' });
    });

    it('redirects to canonical URL for paid URL bid with http', () => {
      const bid: BidRedirectMetadata = {
        ...baseBid,
        entry_type: 'url',
        entry_canonical_url: 'http://example.com/path',
      };

      const result = resolveRedirectDestination(bid);

      expect(result).toEqual({ ok: true, destination: 'http://example.com/path' });
    });

    it('rejects non-http/https protocols', () => {
      const bid: BidRedirectMetadata = {
        ...baseBid,
        entry_type: 'url',
        entry_canonical_url: 'javascript:alert(1)',
      };

      const result = resolveRedirectDestination(bid);

      expect(result).toEqual({ ok: false, reason: 'invalid_url' });
    });

    it('rejects data: protocol', () => {
      const bid: BidRedirectMetadata = {
        ...baseBid,
        entry_type: 'url',
        entry_canonical_url: 'data:text/html,<script>alert(1)</script>',
      };

      const result = resolveRedirectDestination(bid);

      expect(result).toEqual({ ok: false, reason: 'invalid_url' });
    });

    it('rejects file: protocol', () => {
      const bid: BidRedirectMetadata = {
        ...baseBid,
        entry_type: 'url',
        entry_canonical_url: 'file:///etc/passwd',
      };

      const result = resolveRedirectDestination(bid);

      expect(result).toEqual({ ok: false, reason: 'invalid_url' });
    });

    it('rejects missing canonical URL', () => {
      const bid: BidRedirectMetadata = {
        ...baseBid,
        entry_type: 'url',
        entry_canonical_url: null,
      };

      const result = resolveRedirectDestination(bid);

      expect(result).toEqual({ ok: false, reason: 'invalid_url' });
    });
  });

  describe('paid @handle bids', () => {
    it('redirects to x.com for paid @handle bid', () => {
      const bid: BidRedirectMetadata = {
        ...baseBid,
        entry_type: 'handle',
        entry_title: '@naxisty',
      };

      const result = resolveRedirectDestination(bid);

      expect(result).toEqual({ ok: true, destination: 'https://x.com/naxisty' });
    });

    it('handles @handle correctly (single @ is removed)', () => {
      const bid: BidRedirectMetadata = {
        ...baseBid,
        entry_type: 'handle',
        entry_title: '@naxisty',
      };

      const result = resolveRedirectDestination(bid);

      expect(result).toEqual({ ok: true, destination: 'https://x.com/naxisty' });
    });

    it('rejects handle with invalid characters', () => {
      const bid: BidRedirectMetadata = {
        ...baseBid,
        entry_type: 'handle',
        entry_title: '@naxisty!',
      };

      const result = resolveRedirectDestination(bid);

      expect(result).toEqual({ ok: false, reason: 'no_destination' });
    });

    it('rejects missing entry_title', () => {
      const bid: BidRedirectMetadata = {
        ...baseBid,
        entry_type: 'handle',
        entry_title: null,
      };

      const result = resolveRedirectDestination(bid);

      expect(result).toEqual({ ok: false, reason: 'no_destination' });
    });
  });

  describe('paid unknown bids', () => {
    it('falls back for entry_type = unknown', () => {
      const bid: BidRedirectMetadata = {
        ...baseBid,
        entry_type: 'unknown',
        entry_canonical_url: 'https://example.com',
      };

      const result = resolveRedirectDestination(bid);

      expect(result).toEqual({ ok: false, reason: 'no_destination' });
    });

    it('falls back for entry_type = null', () => {
      const bid: BidRedirectMetadata = {
        ...baseBid,
        entry_type: null,
        entry_canonical_url: 'https://example.com',
      };

      const result = resolveRedirectDestination(bid);

      expect(result).toEqual({ ok: false, reason: 'no_destination' });
    });
  });

  describe('pending bids', () => {
    it('rejects pending URL bid', () => {
      const bid: BidRedirectMetadata = {
        ...baseBid,
        status: 'pending',
        entry_type: 'url',
        entry_canonical_url: 'https://walmart.com/',
      };

      const result = resolveRedirectDestination(bid);

      expect(result).toEqual({ ok: false, reason: 'not_paid' });
    });

    it('rejects pending @handle bid', () => {
      const bid: BidRedirectMetadata = {
        ...baseBid,
        status: 'pending',
        entry_type: 'handle',
        entry_title: '@naxisty',
      };

      const result = resolveRedirectDestination(bid);

      expect(result).toEqual({ ok: false, reason: 'not_paid' });
    });

    it('rejects failed bid', () => {
      const bid: BidRedirectMetadata = {
        ...baseBid,
        status: 'failed',
        entry_type: 'url',
        entry_canonical_url: 'https://walmart.com/',
      };

      const result = resolveRedirectDestination(bid);

      expect(result).toEqual({ ok: false, reason: 'not_paid' });
    });
  });
});

describe('getFallbackUrl', () => {
  it('returns the homepage', () => {
    expect(getFallbackUrl()).toBe('/');
  });
});
