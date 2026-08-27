import { GET } from './route';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockMaybeSingle, mockFrom } = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn();
  const mockFrom = vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: mockMaybeSingle,
  }));
  return { mockMaybeSingle, mockFrom };
});

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn().mockResolvedValue({
    from: mockFrom,
  }),
}));

vi.mock('@/lib/redirect-resolver', () => ({
  resolveRedirectDestination: vi.fn(),
  getFallbackUrl: vi.fn().mockReturnValue('/'),
}));

import { resolveRedirectDestination, getFallbackUrl } from '@/lib/redirect-resolver';

describe('GET /next/[id]', () => {
  const mockBid = {
    id: 'test-bid-1',
    category_id: 'cat-1',
    amount: 10000,
    bidder_email: 'test@example.com',
    bidder_name: 'Test Bidder',
    stripe_session_id: 'cs_test_1',
    stripe_payment_intent_id: 'pi_test_1',
    status: 'paid',
    is_highest: false,
    created_at: '2026-01-01T00:00:00Z',
    paid_at: '2026-01-01T00:00:00Z',
    entry_title: 'https://walmart.com/',
    entry_description: 'Test description',
    entry_canonical_url: 'https://walmart.com/',
    entry_image_url: null,
    entry_favicon_url: null,
    entry_type: 'url',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveRedirectDestination).mockReset();
    vi.mocked(getFallbackUrl).mockReturnValue('/');
    mockMaybeSingle.mockReset();
    mockFrom.mockReset();
  });

  describe('valid paid URL bid', () => {
    it('redirects to canonical URL', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: mockBid,
        error: null,
      });

      vi.mocked(resolveRedirectDestination).mockReturnValueOnce({
        ok: true,
        destination: 'https://walmart.com/',
      });

      const response = await GET(new Request('http://localhost:3000/next/test-bid-1'), {
        params: Promise.resolve({ id: 'test-bid-1' }),
      });

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('https://walmart.com/');
    });

    it('redirects to x.com for @handle bid', async () => {
      const handleBid = {
        ...mockBid,
        entry_type: 'handle',
        entry_title: '@naxisty',
        entry_canonical_url: null,
      };

      mockMaybeSingle.mockResolvedValueOnce({
        data: handleBid,
        error: null,
      });

      vi.mocked(resolveRedirectDestination).mockReturnValueOnce({
        ok: true,
        destination: 'https://x.com/naxisty',
      });

      const response = await GET(new Request('http://localhost:3000/next/test-bid-1'), {
        params: Promise.resolve({ id: 'test-bid-1' }),
      });

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('https://x.com/naxisty');
    });
  });

  describe('pending bids', () => {
    it('returns 404 for pending bid', async () => {
      const pendingBid = { ...mockBid, status: 'pending' };

      mockMaybeSingle.mockResolvedValueOnce({
        data: pendingBid,
        error: null,
      });

      vi.mocked(resolveRedirectDestination).mockReturnValueOnce({
        ok: false,
        reason: 'not_paid',
      });

      const response = await GET(new Request('http://localhost:3000/next/test-bid-1'), {
        params: Promise.resolve({ id: 'test-bid-1' }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe('unknown bid', () => {
    it('returns 404 for entry_type = unknown', async () => {
      const unknownBid = { ...mockBid, entry_type: 'unknown' };

      mockMaybeSingle.mockResolvedValueOnce({
        data: unknownBid,
        error: null,
      });

      vi.mocked(resolveRedirectDestination).mockReturnValueOnce({
        ok: false,
        reason: 'no_destination',
      });

      const response = await GET(new Request('http://localhost:3000/next/test-bid-1'), {
        params: Promise.resolve({ id: 'test-bid-1' }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe('missing bid', () => {
    it('returns 404 for nonexistent bid', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const response = await GET(new Request('http://localhost:3000/next/nonexistent'), {
        params: Promise.resolve({ id: 'nonexistent' }),
      });

      expect(response.status).toBe(404);
    });

    it('returns 404 on database error', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'database unavailable' },
      });

      const response = await GET(new Request('http://localhost:3000/next/test-bid-1'), {
        params: Promise.resolve({ id: 'test-bid-1' }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe('invalid URLs', () => {
    it('returns 404 for invalid canonical URL', async () => {
      const invalidBid = { ...mockBid, entry_canonical_url: 'javascript:alert(1)' };

      mockMaybeSingle.mockResolvedValueOnce({
        data: invalidBid,
        error: null,
      });

      vi.mocked(resolveRedirectDestination).mockReturnValueOnce({
        ok: false,
        reason: 'invalid_url',
      });

      const response = await GET(new Request('http://localhost:3000/next/test-bid-1'), {
        params: Promise.resolve({ id: 'test-bid-1' }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe('invalid id', () => {
    it('returns 404 for empty id', async () => {
      const response = await GET(new Request('http://localhost:3000/next/'), {
        params: Promise.resolve({ id: '' }),
      });

      expect(response.status).toBe(404);
    });
  });
});
