import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Task 10.7 - error-monitoring adapter tests.
 *
 * The Sentry SDK is mocked at the module boundary; these tests pin the adapter
 * contract: lazy/no-op behavior without credentials, swallow-all failure handling,
 * strict URL sanitization (no query strings can ever reach the provider), and a
 * capture context containing ONLY safe fields - never headers, cookies, bodies,
 * tokens, or identifiers.
 */

const sentryMock = vi.hoisted(() => {
  const state = {
    init: vi.fn(),
    captureException: vi.fn(),
    importAttempts: 0,
  };

  return state;
});

vi.mock('@sentry/nextjs', () => {
  // Record that the SDK module was actually imported - the adapter must not touch it
  // without credentials.
  sentryMock.importAttempts += 1;

  return {
    init: sentryMock.init,
    captureException: sentryMock.captureException,
  };
});

import {
  initErrorMonitor,
  reportError,
  reportRequestError,
  sanitizeErrorUrl,
} from './error-monitor';

beforeEach(() => {
  vi.unstubAllEnvs();
  delete process.env.SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  sentryMock.init.mockReset();
  sentryMock.captureException.mockReset();
  sentryMock.captureException.mockReturnValue('event-id');
  sentryMock.importAttempts = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sanitizeErrorUrl (Task 10.7)', () => {
  it('strips query strings so session ids can never be transmitted', () => {
    expect(sanitizeErrorUrl('https://topbid.lol/success?session_id=cs_secret_123')).toBe(
      'https://topbid.lol/success'
    );
  });

  it('strips capability tokens from unsubscribe URLs', () => {
    expect(sanitizeErrorUrl(`https://topbid.lol/unsubscribe?token=${'a'.repeat(64)}`)).toBe(
      'https://topbid.lol/unsubscribe'
    );
  });

  it('strips fragments and preserves only origin + pathname', () => {
    expect(sanitizeErrorUrl('https://topbid.lol/categories/art#leaderboard')).toBe(
      'https://topbid.lol/categories/art'
    );
  });

  it.each([null, undefined, '', '   ', 123, {}])('returns null for unusable input %p', (input) => {
    expect(sanitizeErrorUrl(input)).toBeNull();
  });

  it('falls back to textual query-stripping for relative paths', () => {
    expect(sanitizeErrorUrl('/success?session_id=x')).toBe('/success');
  });
});

describe('initialization without credentials (Task 10.7)', () => {
  it('never imports or touches the SDK when no DSN is configured', async () => {
    await initErrorMonitor();
    await reportError(new Error('boom'));
    await reportRequestError({ url: 'https://x.test/success' }, new Error('boom'), {});

    expect(sentryMock.importAttempts).toBe(0);
    expect(sentryMock.init).not.toHaveBeenCalled();
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });
});

describe('initialization with credentials (Task 10.7)', () => {
  it('initializes once with privacy-first options when SENTRY_DSN is set', async () => {
    process.env.SENTRY_DSN = 'https://public@sentry.example.com/1';

    await initErrorMonitor();

    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    expect(sentryMock.init).toHaveBeenCalledWith({
      dsn: 'https://public@sentry.example.com/1',
      sendDefaultPii: false,
      tracesSampleRate: 0,
    });

    await initErrorMonitor();

    expect(sentryMock.init).toHaveBeenCalledTimes(1);
  });
});

describe('reportError (Task 10.7)', () => {
  it('forwards unexpected exceptions to the provider when configured', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@sentry.example.com/2';
    const boom = new Error('unexpected');

    await reportError(boom);

    expect(sentryMock.captureException).toHaveBeenCalledWith(boom);
  });

  it('swallows reporter failures - the original error path is never affected', async () => {
    process.env.SENTRY_DSN = 'https://public@sentry.example.com/3';
    sentryMock.captureException.mockImplementation(() => {
      throw new Error('provider down');
    });

    await expect(reportError(new Error('original'))).resolves.toBeUndefined();
  });
});

describe('reportRequestError (Task 10.7)', () => {
  it('transmits ONLY sanitized URLs and safe context - never headers/cookies/bodies/queries', async () => {
    process.env.SENTRY_DSN = 'https://public@sentry.example.com/4';

    const request = {
      url: 'https://topbid.lol/success?session_id=cs_live_secret',
      method: 'GET',
      headers: { cookie: 'session=SECRET', authorization: 'Bearer SECRET' },
      body: JSON.stringify({ password: 'SECRET' }),
    };
    const context = {
      routerPath: '/success',
      headers: { cookie: 'SECRET' },
      cookies: { session: 'SECRET' },
    };

    await reportRequestError(request, new Error('unhandled'), context);

    const [, eventHint] = sentryMock.captureException.mock.calls[0];
    const serialized = JSON.stringify(eventHint);

    expect(serialized).not.toContain('cs_live_secret');
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('password');
    expect(eventHint.contexts.request.url).toBe('https://topbid.lol/success');
    expect(Object.keys(eventHint.contexts.request)).toEqual(['url', 'method']);
    expect(eventHint.tags).toEqual({ router_path: '/success' });
  });

  it('omits tags when no router path exists and handles unusable request urls', async () => {
    process.env.SENTRY_DSN = 'https://public@sentry.example.com/5';

    await reportRequestError({}, new Error('unhandled'), {});

    const [, eventHint] = sentryMock.captureException.mock.calls[0];

    expect(eventHint.tags).toEqual({});
    expect(eventHint.contexts.request.url).toBe('unknown');
  });

  it('swallows provider failures during request-error reporting', async () => {
    process.env.SENTRY_DSN = 'https://public@sentry.example.com/6';
    sentryMock.captureException.mockImplementation(() => {
      throw new Error('network unreachable');
    });

    await expect(
      reportRequestError({ url: 'https://x.test/' }, new Error('e'), {})
    ).resolves.toBeUndefined();
  });
});
