import type { Metadata } from 'next';

/**
 * Shared SEO directives for non-indexable pages (Task 10.5).
 *
 * Applied to every surface that must never appear in search engines: the payment
 * result pages (/success echoes a Checkout Session identifier in its URL; /cancel is
 * payment plumbing), the capability-token-gated /unsubscribe landing page (indexing it
 * would leak recipient tokens to search engines), and all /admin surfaces (private,
 * and their existence should not even be advertised).
 *
 * Kept as one exported constant so tests can pin every private page's metadata against
 * the exact same directive instead of hand-copied objects.
 */
export const NO_INDEX: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};
