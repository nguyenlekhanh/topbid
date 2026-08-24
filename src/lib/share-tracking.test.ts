import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SHARE_EVENTS, isShareEvent, trackShareEvent } from './share-tracking';

/**
 * Task 7.7 — deterministic tests for the share-tracking boundary.
 * fetch is stubbed globally; no real network requests occur.
 */

const fetchMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 204 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isShareEvent', () => {
  it('accepts exactly the two defined share events', () => {
    expect(SHARE_EVENTS).toEqual(['x_share', 'copy_link']);
    expect(isShareEvent('x_share')).toBe(true);
    expect(isShareEvent('copy_link')).toBe(true);
  });

  it.each([null, undefined, 42, '', 'x_share ', 'share_x', 'page_view', '{}'])(
    'rejects %p',
    (value) => {
      expect(isShareEvent(value)).toBe(false);
    }
  );
});

describe('trackShareEvent', () => {
  it('posts the minimal event-only payload to the internal endpoint', async () => {
    await trackShareEvent('x_share');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('/api/share-events');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({ event: 'x_share' });
    // Payload is event-only: nothing else may ride along.
    expect(Object.keys(JSON.parse(init.body as string))).toEqual(['event']);
  });

  it('tracks copy-link events identically', async () => {
    await trackShareEvent('copy_link');

    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      event: 'copy_link',
    });
  });

  it('swallows network failures without throwing', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(trackShareEvent('x_share')).resolves.toBeUndefined();
  });

  it('swallows non-2xx responses instead of surfacing errors', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(trackShareEvent('copy_link')).resolves.toBeUndefined();
  });

  it('never dispatches for invalid event names', async () => {
    await trackShareEvent('page_view' as never);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fire on its own - only when explicitly invoked', () => {
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
