import { describe, expect, it } from 'vitest';

import { lookupRecordValue } from './safe-lookup';

/**
 * Task 9.1 — deterministic tests for the prototype-safe record lookup used by
 * admin banner pages (search-parameter driven message maps).
 */

const MESSAGES: Record<string, string> = {
  created: 'Category created.',
  slug_taken: 'That slug is already in use.',
};

describe('lookupRecordValue', () => {
  it('returns the mapped value for an own key', () => {
    expect(lookupRecordValue(MESSAGES, 'created', 'fallback')).toBe('Category created.');
    expect(lookupRecordValue(MESSAGES, 'slug_taken', 'fallback')).toBe(
      'That slug is already in use.'
    );
  });

  it('returns the fallback for missing keys', () => {
    expect(lookupRecordValue(MESSAGES, 'unknown', 'fallback')).toBe('fallback');
  });

  it.each([null, undefined, '', '__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'never resolves inherited/unsafe keys (%p) through the prototype chain',
    (key) => {
      const result = lookupRecordValue(MESSAGES as Record<string, string>, key as string, 'fb');

      // None of these keys may resolve to inherited objects/functions.
      expect(typeof result).toBe('string');
      expect(result).toBe('fb');
    }
  );

  it('does not crash on keys that shadow nothing but look dangerous', () => {
    const map: Record<string, string> = { ...MESSAGES };
    expect(() => lookupRecordValue(map, '__proto__', 'safe')).not.toThrow();
    expect(lookupRecordValue(map, '__proto__', 'safe')).toBe('safe');
  });
});
