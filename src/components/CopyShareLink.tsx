'use client';

import { useEffect, useRef, useState } from 'react';

import { copyToClipboard } from '@/lib/copy-to-clipboard';

/**
 * Copy-share-link button (Task 7.3).
 *
 * - Copies the canonical public share URL only on explicit user activation (never
 *   during render, never automatically)
 * - Local feedback state: idle -> 'Copied!' / 'Copy failed' with an auto-reset so the
 *   action remains repeatable; timer is cleanup-safe on unmount
 * - Clipboard rejection or unavailable API renders failure feedback without crashing
 * - Keyboard accessible via native button semantics; no external toast dependency
 */
export default function CopyShareLink({ url }: { url: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  async function handleClick() {
    const outcome = await copyToClipboard(url);

    setStatus(outcome);

    if (resetTimer.current !== null) {
      clearTimeout(resetTimer.current);
    }

    resetTimer.current = setTimeout(() => setStatus('idle'), 2000);
  }

  const label = status === 'copied' ? 'Copied!' : status === 'failed' ? 'Copy failed' : 'Copy link';

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-live="polite"
      className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg border border-border bg-background px-5 py-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-11"
    >
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {status === 'copied' ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        )}
      </svg>
      {label}
    </button>
  );
}
