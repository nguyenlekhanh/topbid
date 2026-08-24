import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as loginPost } from '@/app/api/admin/login/route';
import { POST as logoutPost } from '@/app/api/admin/logout/route';

/**
 * Task 8.1 — deterministic tests for the admin login/logout endpoints.
 * The Supabase Auth boundary is faked at the client level; no real network/auth calls.
 */

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
  }),
}));

function postForm(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields).toString();

  return new Request('http://localhost/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

beforeEach(() => {
  mocks.signInWithPassword.mockReset();
  mocks.signOut.mockReset();
  mocks.signInWithPassword.mockResolvedValue({
    data: { session: { access_token: 'secret-token' } },
    error: null,
  });
  mocks.signOut.mockResolvedValue({ error: null });
});

describe('POST /api/admin/login', () => {
  it('signs in valid credentials and redirects to the default admin destination', async () => {
    const response = await loginPost(
      postForm({ email: 'admin@topbid.lol', password: 'correct-horse' })
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/admin');
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'admin@topbid.lol',
      password: 'correct-horse',
    });
  });

  it.each([
    ['missing email', { password: 'pw' }],
    ['missing password', { email: 'a@b.com' }],
    ['blank credentials', { email: '   ', password: '   ' }],
  ])('%s redirects back with a generic error flag', async (_label, fields) => {
    const response = await loginPost(postForm(fields));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/admin/login?error=1');
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it('returns an identical generic failure for wrong credentials (no existence leak)', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    });

    const response = await loginPost(
      postForm({ email: 'who-knows@if-exists.com', password: 'wrong' })
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/admin/login?error=1');

    const location = response.headers.get('location') ?? '';
    expect(location).not.toContain('who-knows');
    expect(location.toLowerCase()).not.toContain('invalid%20login');
  });

  it('honors a safe same-origin next path', async () => {
    const response = await loginPost(
      postForm({ email: 'admin@topbid.lol', password: 'pw', next: '/admin/settings' })
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/admin/settings');
  });

  it.each([
    ['absolute external URL', 'https://evil.example.com/steal'],
    ['protocol-relative URL', '//evil.example.com'],
    ['backslash trick', '/\\evil.example.com'],
    ['relative-but-not-path', 'admin/x'],
  ])('blocks open-redirect attempt via %p', async (_label, next) => {
    const response = await loginPost(postForm({ email: 'admin@topbid.lol', password: 'pw', next }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/admin');
  });

  it('never echoes credentials or tokens in the redirect target', async () => {
    const response = await loginPost(
      postForm({ email: 'admin@topbid.lol', password: 'super-secret-pw' })
    );

    const location = response.headers.get('location') ?? '';
    expect(location).not.toContain('super-secret-pw');
    expect(location).not.toContain('access_token');
  });
});

describe('POST /api/admin/logout', () => {
  it('signs out server-side and returns to the login page', async () => {
    const request = new Request('http://localhost/api/admin/logout', { method: 'POST' });

    const response = await logoutPost(request);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/admin/login');
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('redirects to the login page even when sign-out reports an error', async () => {
    mocks.signOut.mockResolvedValue({ error: { message: 'session already gone' } });

    const response = await logoutPost(
      new Request('http://localhost/api/admin/logout', { method: 'POST' })
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/admin/login');
  });
});
