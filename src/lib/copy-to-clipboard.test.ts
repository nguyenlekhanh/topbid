import { describe, expect, it, vi } from 'vitest';

import { copyToClipboard } from './copy-to-clipboard';

/**
 * Task 7.3 — deterministic tests for the clipboard boundary.
 * The browser Clipboard API is never touched: the writer is injected.
 */

describe('copyToClipboard', () => {
  it('resolves copied when the injected write succeeds', async () => {
    const write = vi.fn().mockResolvedValue(undefined);

    await expect(copyToClipboard('https://topbid.lol/#leaderboard-heading', write)).resolves.toBe(
      'copied'
    );
    expect(write).toHaveBeenCalledWith('https://topbid.lol/#leaderboard-heading');
  });

  it('copies the exact canonical URL text verbatim', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const canonical = 'https://topbid.lol/#leaderboard-heading';

    await copyToClipboard(canonical, write);

    const written = write.mock.calls[0][0] as string;
    expect(written).toBe(canonical);
    expect(written).not.toContain('session_id');
    expect(written).not.toContain('cs_');
    expect(written).not.toContain('pi_');
    expect(written).not.toContain('@');
  });

  it('resolves failed when the clipboard write rejects', async () => {
    const write = vi.fn().mockRejectedValue(new Error('NotAllowedError'));

    await expect(copyToClipboard('text', write)).resolves.toBe('failed');
  });

  it('never throws even when the write throws synchronously', async () => {
    const write = vi.fn().mockImplementation(() => {
      throw new Error('sync failure');
    });

    await expect(copyToClipboard('text', write)).resolves.toBe('failed');
  });

  it('resolves failed when no writer and no Clipboard API exist', async () => {
    // Node test environment has no navigator.clipboard - exercises the unsupported path.
    await expect(copyToClipboard('text')).resolves.toBe('failed');
  });

  it('supports repeated copies through the same boundary', async () => {
    const write = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined);

    await expect(copyToClipboard('a', write)).resolves.toBe('copied');
    await expect(copyToClipboard('a', write)).resolves.toBe('failed');
    await expect(copyToClipboard('a', write)).resolves.toBe('copied');
    expect(write).toHaveBeenCalledTimes(3);
  });
});
