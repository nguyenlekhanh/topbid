import { describe, expect, it } from 'vitest';

import { isPublicAnalyticsPath } from './analytics-gate';

/**
 * Task 10.6 - analytics route-gate tests.
 *
 * The gate decides which paths may emit pageview analytics. Every private surface
 * excluded by Task 10.5 must be blocked, matching must be segment-exact (no prefix
 * false-positives), and malformed input must fail closed to "not tracked".
 */
describe('isPublicAnalyticsPath (Task 10.6)', () => {
  it.each(['/', '/categories/art', '/categories/weird%20%26%20slug'])(
    'allows public path %p',
    (path) => {
      expect(isPublicAnalyticsPath(path)).toBe(true);
    }
  );

  it.each([
    ['/admin', 'dashboard'],
    ['/admin/login', 'nested admin route'],
    ['/api', 'api root'],
    ['/api/share-events', 'api endpoint'],
    ['/api/webhooks/stripe', 'webhook endpoint'],
    ['/success', 'payment result'],
    ['/success/', 'payment result with trailing slash'],
    ['/unsubscribe', 'capability-token page'],
  ])('blocks private path %p (%s)', (path) => {
    expect(isPublicAnalyticsPath(path)).toBe(false);
  });

  it('matches prefixes segment-exactly so public routes are never swallowed', () => {
    expect(isPublicAnalyticsPath('/administrator-guide')).toBe(true);
    expect(isPublicAnalyticsPath('/apiary')).toBe(true);
    expect(isPublicAnalyticsPath('/successful-bids')).toBe(true);
    expect(isPublicAnalyticsPath('/unsubscribe-guide')).toBe(true);
  });

  it.each([null, undefined, '', 'not-a-path', 'https://evil.example.com/admin'])(
    'fails closed to not-tracked for malformed input %p',
    (input) => {
      expect(isPublicAnalyticsPath(input)).toBe(false);
    }
  );
});
