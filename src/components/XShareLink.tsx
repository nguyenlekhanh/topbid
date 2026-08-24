'use client';

import { trackShareEvent } from '@/lib/share-tracking';

/**
 * Share-on-X action (Task 7.2) with first-party share tracking (Task 7.7).
 *
 * - Renders the standard external anchor; target=_blank keeps this page alive, so the
 *   fire-and-forget tracking POST completes normally alongside navigation
 * - Tracking is invoked only on explicit user activation and never blocks or breaks
 *   the share action - failures inside trackShareEvent are swallowed by design
 */
export default function XShareLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        void trackShareEvent('x_share');
      }}
      className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-foreground px-5 py-3 text-sm font-medium text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-11"
    >
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
      Share on X
    </a>
  );
}
