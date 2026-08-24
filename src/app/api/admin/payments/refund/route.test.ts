import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/admin/payments/refund/route';

/**
 * Task 8.6 - deterministic tests for the refund endpoint's routing/redirect
 * semantics. The action (Stripe + RPC orchestration) is mocked; it has its own suite.
 */

const actionMock = vi.hoisted(() => ({
  initiateAdminRefund: vi.fn(),
}));

vi.mock('@/lib/admin-refunds', () => ({
  initiateAdminRefund: actionMock.initiateAdminRefund,
}));

function postRequest(body: string, contentType = 'application/json'): Request {
  return new Request('http://localhost/api/admin/payments/refund', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  });
}

beforeEach(() => {
  actionMock.initiateAdminRefund.mockReset();
  // Default for unspecified flows: invalid/absent input is rejected by the action.
  actionMock.initiateAdminRefund.mockResolvedValue({ ok: false, reason: 'invalid_bid_id' });
});

describe('POST /api/admin/payments/refund', () => {
  it.each([
    [
      { bid_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' },
      { result: 'refunded' },
      { ok: true, outcome: 'refunded', refundId: 're_1' },
    ],
    [
      { bid_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' },
      { result: 'already_refunded' },
      { ok: true, outcome: 'already_refunded', refundId: 're_1' },
    ],
    [
      { bid_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' },
      { result: 'refund_submitted' },
      { ok: true, outcome: 'refund_submitted', refundId: 're_p' },
    ],
  ])('redirects %o to %o on success', async (body, expectedParams, resolved) => {
    actionMock.initiateAdminRefund.mockResolvedValue(resolved);

    const response = await POST(postRequest(JSON.stringify(body)));

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location') ?? 'http://localhost/invalid');
    expect(location.pathname).toBe('/admin/payments');
    for (const [key, value] of Object.entries(expectedParams)) {
      expect(location.searchParams.get(key)).toBe(value);
    }
    expect(actionMock.initiateAdminRefund).toHaveBeenCalledWith({
      bidId: body.bid_id,
    });
  });

  it.each([
    ['unauthorized', '/admin/login'],
    ['not_found', '/admin/payments'],
    ['not_refundable', '/admin/payments'],
    ['missing_payment_intent', '/admin/payments'],
    ['provider_failed', '/admin/payments'],
    ['db_pending', '/admin/payments'],
  ])('maps failure reason %s to the correct redirect', async (reason, expectedPath) => {
    actionMock.initiateAdminRefund.mockResolvedValue({ ok: false, reason });

    const response = await POST(
      postRequest(JSON.stringify({ bid_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }))
    );

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location') ?? 'http://localhost/invalid');
    expect(location.pathname).toBe(expectedPath);
    if (expectedPath === '/admin/payments') {
      expect(location.searchParams.get('error')).toBe(reason);
    }
  });

  it('accepts urlencoded form bodies carrying bid_id', async () => {
    actionMock.initiateAdminRefund.mockResolvedValue({
      ok: true,
      outcome: 'refunded',
      refundId: 're_form',
    });

    const response = await POST(postForm({ bid_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }));

    expect(response.status).toBe(303);
    expect(new URL(response.headers.get('location')!).searchParams.get('result')).toBe('refunded');
  });

  function postForm(fields: Record<string, string>): Request {
    return new Request('http://localhost/api/admin/payments/refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
  }

  it('routes malformed input to the payments error flag via the action guard', async () => {
    const response = await POST(postRequest('{broken json', 'application/json'));

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/admin/payments');
    expect(location.searchParams.get('error')).toBe('invalid_bid_id');
    expect(actionMock.initiateAdminRefund).toHaveBeenCalledWith({ bidId: undefined });
  });
});
