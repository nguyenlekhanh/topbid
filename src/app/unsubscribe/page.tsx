import type { Metadata } from 'next';
import Link from 'next/link';

import { NO_INDEX } from '@/lib/seo';
import { hasUnsubscribeRecord, isValidUnsubscribeTokenShape } from '@/lib/unsubscribe';

// Reads request searchParams and performs an authoritative suppression lookup per
// request - never prerendered.
export const dynamic = 'force-dynamic';

// Task 10.5: capability-token surface - never indexed (indexing could expose tokens).
export const metadata: Metadata = {
  ...NO_INDEX,
  title: 'Unsubscribe — Topbid.lol',
};

/**
 * Unsubscribe landing page (Task 6.6).
 *
 * - GET only: rendering never mutates state (email scanners prefetch links)
 * - The token is the recipient capability token from the notification footer; the
 *   page renders the AUTHORITATIVE suppression state for it via hasUnsubscribeRecord
 * - Confirmation happens through the POST form targeting /api/unsubscribe
 * - Malformed/missing tokens get a neutral message that leaks nothing about whether
 *   any particular recipient exists
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawToken = typeof params.token === 'string' ? params.token : null;
  const submitted = params.submitted === '1';
  const validShape = isValidUnsubscribeTokenShape(rawToken);
  const alreadyUnsubscribed = validShape ? await hasUnsubscribeRecord(rawToken) : false;

  return (
    <section className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-sm sm:p-8">
        {!validShape ? (
          <>
            <h1 className="text-xl font-semibold text-foreground">Invalid unsubscribe link</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              This unsubscribe link appears to be malformed. Please use the exact link from your
              outbid notification email.
            </p>
          </>
        ) : alreadyUnsubscribed ? (
          <>
            <h1 className="text-xl font-semibold text-foreground">
              {submitted ? 'You are unsubscribed' : 'Already unsubscribed'}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              This recipient will no longer receive outbid notifications from Topbid.lol.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-foreground">
              Unsubscribe from outbid emails?
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              You will stop receiving outbid notifications from Topbid.lol. Confirm below to opt
              out.
            </p>
            <form action="/api/unsubscribe" method="post" className="mt-6">
              <input type="hidden" name="token" value={rawToken} />
              <button
                type="submit"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto"
              >
                Confirm unsubscribe
              </button>
            </form>
          </>
        )}

        <div className="mt-6 border-t border-border pt-4">
          <Link
            href="/"
            className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors duration-200 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
          >
            Back to Topbid.lol
          </Link>
        </div>
      </div>
    </section>
  );
}
