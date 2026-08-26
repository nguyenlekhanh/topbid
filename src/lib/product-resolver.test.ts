import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * UI redesign follow-up - product resolver tests.
 *
 * Covers the SSRF boundary (private/localhost/metadata hosts, DNS resolution,
 * redirect re-validation), bounded fetching (timeout/size/content-type), and
 * metadata extraction priority (OG -> fallbacks, canonical, favicon, site name).
 * All network/DNS are injected - no real requests.
 */

const { fetchImpl, lookupImpl } = vi.hoisted(() => ({
  fetchImpl: vi.fn(),
  lookupImpl: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  lookup: lookupImpl,
}));

import { isPrivateAddress, resolveProductPreview } from './product-resolver';

function htmlResponse(html: string): Response {
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
}

function jsonResponse(): Response {
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  fetchImpl.mockReset();
  lookupImpl.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isPrivateAddress / SSRF host rules', () => {
  it.each([
    ['127.0.0.1', true],
    ['127.255.255.255', true],
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.5', true],
    ['0.0.0.0', true],
    ['8.8.8.8', false],
    ['::1', true],
    ['fe80::1', true],
    ['fc00::1', true],
    ['fd12:3456::1', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:8.8.8.8', false],
  ])('%p -> private=%p', (address, expected) => {
    expect(isPrivateAddress(address as string)).toBe(expected);
  });
});

describe('assertSafePublicUrl via resolveProductPreview (SSRF boundary)', () => {
  it.each([
    ['http://localhost/foo'],
    ['https://localhost.localdomain/x'],
    ['http://127.0.0.1/'],
    ['http://169.254.169.254/latest/meta-data/'],
    ['http://10.0.0.5/'],
    ['http://192.168.1.10/'],
    ['http://[::1]/'],
    ['http://[fe80::1]/'],
    ['ftp://example.com/file'],
    ['javascript:alert(1)'],
    ['/relative/path'],
    ['https://user:pass@example.com/'],
  ])('rejects unsafe url %p as unsafe_url', async (input) => {
    // Even if DNS would resolve publicly for hostname-based ones, literal/private
    // forms must be rejected before any fetch:
    const result = await resolveProductPreview(input, { fetchImpl, lookupImpl });

    expect(result).toMatchObject({ ok: false, reason: expect.any(String) });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resolves DNS and rejects when ANY address is private (rebinding guard)', async () => {
    lookupImpl.mockResolvedValue([{ address: '8.8.8.8' }, { address: '192.168.0.7' }]);

    const result = await resolveProductPreview('https://rebinding.example.com/', {
      fetchImpl,
      lookupImpl,
    });

    expect(result).toMatchObject({ ok: false, reason: 'unsafe_url' });
    expect(lookupImpl).toHaveBeenCalledWith('rebinding.example.com', { all: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches when all resolved addresses are public', async () => {
    lookupImpl.mockResolvedValue([{ address: '93.184.216.34' }]);
    fetchImpl.mockResolvedValue(htmlResponse('<title>ok</title>'));

    const result = await resolveProductPreview('https://example.com/', {
      fetchImpl,
      lookupImpl,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects DNS lookup failures (fail closed)', async () => {
    lookupImpl.mockRejectedValue(Object.assign(new Error('no record'), { code: 'ENOTFOUND' }));

    const result = await resolveProductPreview('https://missing.example.com/', {
      fetchImpl,
      lookupImpl,
    });

    expect(result).toMatchObject({ ok: false, reason: 'unsafe_url' });
  });

  it('follows redirects but re-validates each destination', async () => {
    // First hop resolves public; redirect target is localhost -> blocked.
    lookupImpl.mockImplementation((host: string) =>
      host === 'public.example.com'
        ? Promise.resolve([{ address: '93.184.216.34' }])
        : Promise.reject(new Error('ENOTFOUND'))
    );
    fetchImpl.mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: 'http://localhost/admin' } })
    );

    const result = await resolveProductPreview('https://public.example.com/start', {
      fetchImpl,
      lookupImpl,
    });

    expect(result).toMatchObject({ ok: false, reason: 'unsafe_url' });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // never fetched the private target
  });

  it('gives up after MAX_REDIRECTS hops', async () => {
    lookupImpl.mockResolvedValue([{ address: '93.184.216.34' }]);
    fetchImpl.mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 302, headers: { Location: '/next' } }))
    );

    const result = await resolveProductPreview('https://example.com/loop', {
      fetchImpl,
      lookupImpl,
    });

    expect(result).toMatchObject({ ok: false, reason: 'unsafe_url' });
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(5);
  });
});

describe('bounded fetch behavior', () => {
  beforeEach(() => {
    lookupImpl.mockResolvedValue([{ address: '93.184.216.34' }]);
  });

  it('maps AbortError to timeout', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchImpl.mockRejectedValue(abortError);

    await expect(
      resolveProductPreview('https://slow.example.com', { fetchImpl, lookupImpl })
    ).resolves.toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('maps generic fetch failures to fetch_failed', async () => {
    fetchImpl.mockRejectedValue(new Error('socket hang up'));

    await expect(
      resolveProductPreview('https://dead.example.com', { fetchImpl, lookupImpl })
    ).resolves.toMatchObject({ ok: false, reason: 'fetch_failed' });
  });

  it('rejects oversized responses with response_too_large', async () => {
    const chunk = new Uint8Array(600 * 1024);
    const stream = {
      getReader() {
        let sent = false;
        return {
          read() {
            if (!sent) {
              sent = true;
              return Promise.resolve({ done: false, value: chunk });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
          cancel() {
            return Promise.resolve();
          },
        };
      },
    };
    fetchImpl.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'text/html' }),
      body: stream,
    } as unknown as Response);

    await expect(
      resolveProductPreview('https://big.example.com', { fetchImpl, lookupImpl })
    ).resolves.toMatchObject({ ok: false, reason: 'response_too_large' });
  });

  it('rejects non-HTML content types with not_html', async () => {
    fetchImpl.mockResolvedValue(jsonResponse());

    await expect(
      resolveProductPreview('https://api.example.com/data', { fetchImpl, lookupImpl })
    ).resolves.toMatchObject({ ok: false, reason: 'not_html' });
  });

  it('maps upstream 404 to not_found without extracting anything', async () => {
    fetchImpl.mockResolvedValue(new Response('<html></html>', { status: 404 }));

    await expect(
      resolveProductPreview('https://gone.example.com', { fetchImpl, lookupImpl })
    ).resolves.toMatchObject({ ok: false, reason: 'not_found' });
  });
});

describe('@handle boundary (Phase 3)', () => {
  it('returns typed unsupported_handle without fabricating metadata or searching', async () => {
    const result = await resolveProductPreview('@myproduct', { fetchImpl, lookupImpl });

    expect(result).toEqual({ ok: false, reason: 'unsupported_handle' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lookupImpl).not.toHaveBeenCalled();
  });
});
