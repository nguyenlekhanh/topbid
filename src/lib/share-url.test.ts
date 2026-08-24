import { describe, expect, it } from 'vitest';

import { buildPublicShareUrl } from './share-url';

/**
 * Task 7.3 — deterministic tests for the canonical public share URL.
 */

describe('buildPublicShareUrl', () => {
  it('builds the homepage leaderboard-anchor share URL', () => {
    expect(buildPublicShareUrl('https://topbid.lol')).toBe(
      'https://topbid.lol/#leaderboard-heading'
    );
  });

  it('normalizes trailing slashes on the base URL', () => {
    expect(buildPublicShareUrl('https://topbid.lol/')).toBe(
      'https://topbid.lol/#leaderboard-heading'
    );
    expect(buildPublicShareUrl('https://topbid.lol///')).toBe(
      'https://topbid.lol/#leaderboard-heading'
    );
  });

  it('contains no Stripe session or payment identifiers', () => {
    const url = buildPublicShareUrl('https://topbid.lol');

    expect(url).not.toContain('session_id');
    expect(url).not.toContain('cs_');
    expect(url).not.toContain('pi_');
    expect(url).not.toContain('token');
    expect(url).not.toContain('@');
  });

  it('is not a /success URL', () => {
    expect(buildPublicShareUrl('https://topbid.lol')).not.toContain('/success');
  });

  it('matches the exact URL embedded in the Task 7.2 X share intent input', () => {
    // Single source of truth: the copy action must copy exactly what Share on X shares.
    const base = 'https://topbid.lol';
    const shared = buildPublicShareUrl(base);

    expect(shared).toBe(`${base}/#leaderboard-heading`);
  });

  it('is deterministic for identical input', () => {
    expect(buildPublicShareUrl('https://topbid.lol')).toBe(
      buildPublicShareUrl('https://topbid.lol')
    );
  });
});
