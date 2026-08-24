import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/admin/categories/route';

/**
 * Task 8.3 — deterministic tests for the category-management endpoint's intent
 * routing and redirect semantics. Management functions are mocked; the real lib
 * logic has its own suite.
 */

const managementMock = vi.hoisted(() => ({
  createAdminCategory: vi.fn(),
  updateAdminCategory: vi.fn(),
  setCategoryActive: vi.fn(),
}));

vi.mock('@/lib/admin-category-management', () => ({
  createAdminCategory: managementMock.createAdminCategory,
  updateAdminCategory: managementMock.updateAdminCategory,
  setCategoryActive: managementMock.setCategoryActive,
}));

function postForm(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields).toString();

  return new Request('http://localhost/api/admin/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

function locationOf(response: Response): URL {
  return new URL(response.headers.get('location') ?? 'http://localhost/invalid');
}

beforeEach(() => {
  managementMock.createAdminCategory.mockReset();
  managementMock.updateAdminCategory.mockReset();
  managementMock.setCategoryActive.mockReset();
});

describe('POST /api/admin/categories — create', () => {
  it('forwards form fields and redirects with result=created on success', async () => {
    managementMock.createAdminCategory.mockResolvedValue({ ok: true });

    const response = await POST(
      postForm({
        intent: 'create',
        slug: 'art',
        name: 'Art',
        description: 'desc',
        starting_bid: '$500',
        increment: '$5',
      })
    );

    expect(response.status).toBe(303);
    expect(locationOf(response).searchParams.get('result')).toBe('created');
    expect(managementMock.createAdminCategory).toHaveBeenCalledWith({
      slug: 'art',
      name: 'Art',
      description: 'desc',
      startingBid: '$500',
      increment: '$5',
    });
  });

  it('redirects with the stable error reason on failure (e.g. slug_taken)', async () => {
    managementMock.createAdminCategory.mockResolvedValue({ ok: false, reason: 'slug_taken' });

    const response = await POST(postForm({ intent: 'create', slug: 'art', name: 'Dup' }));

    expect(response.status).toBe(303);
    expect(locationOf(response).searchParams.get('error')).toBe('slug_taken');
  });
});

describe('POST /api/admin/categories - update', () => {
  it('forwards the id plus mutable fields and reports result=updated', async () => {
    managementMock.updateAdminCategory.mockResolvedValue({ ok: true });

    const response = await POST(
      postForm({
        intent: 'update',
        id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        name: 'Renamed',
        starting_bid: '600',
      })
    );

    expect(response.status).toBe(303);
    expect(locationOf(response).searchParams.get('result')).toBe('updated');
    expect(managementMock.updateAdminCategory).toHaveBeenCalledWith({
      id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      name: 'Renamed',
      startingBid: '600',
    });
  });
});

describe('POST /api/admin/categories - set_active', () => {
  it.each([
    ['true', 'activated'],
    ['false', 'deactivated'],
  ])('toggles to %p and reports %s', async (active, result) => {
    managementMock.setCategoryActive.mockResolvedValue({ ok: true });

    const response = await POST(
      postForm({
        intent: 'set_active',
        id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        active,
      })
    );

    expect(response.status).toBe(303);
    expect(locationOf(response).searchParams.get('result')).toBe(result);
    expect(managementMock.setCategoryActive).toHaveBeenCalledWith({
      id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      active,
    });
  });
});

describe('POST /api/admin/categories - validation', () => {
  it('rejects unknown intents with error=invalid_input and no lib call', async () => {
    const response = await POST(postForm({ intent: 'delete', id: 'x' }));

    expect(response.status).toBe(303);
    expect(locationOf(response).searchParams.get('error')).toBe('invalid_input');
    expect(managementMock.createAdminCategory).not.toHaveBeenCalled();
    expect(managementMock.updateAdminCategory).not.toHaveBeenCalled();
    expect(managementMock.setCategoryActive).not.toHaveBeenCalled();
  });

  it('propagates unauthorized as an error flag like any other stable reason', async () => {
    managementMock.createAdminCategory.mockResolvedValue({ ok: false, reason: 'unauthorized' });

    const response = await POST(
      postForm({ intent: 'create', slug: 'x', name: 'X', starting_bid: '1', increment: '1' })
    );

    expect(locationOf(response).searchParams.get('error')).toBe('unauthorized');
  });

  it('handles malformed bodies safely via the invalid-input path', async () => {
    const request = new Request('http://localhost/api/admin/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"not":"form-data"}',
    });

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(locationOf(response).searchParams.get('error')).toBe('invalid_input');
  });
});
