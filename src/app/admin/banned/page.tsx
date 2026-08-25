import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { listBannedEmails } from '@/lib/email-bans';
import { NO_INDEX } from '@/lib/seo';
import { lookupRecordValue } from '@/lib/safe-lookup';
import { createClient } from '@/lib/supabase-server';

export const metadata: Metadata = {
  ...NO_INDEX,
  title: 'Banned emails — Topbid.lol',
};

const RESULT_MESSAGES: Record<string, string> = {
  banned: 'Email banned.',
  already_banned: 'That email was already banned.',
  unbanned: 'Email unbanned.',
  not_banned: 'That email was not on the blocklist.',
};

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'You are not authorized to manage the blocklist.',
  invalid_email: 'That email address is invalid.',
  db_error: 'A database error occurred. Please try again.',
  invalid_intent: 'Unknown action.',
};

const inputClasses =
  'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/**
 * Fraud/banned email management (Task 8.7).
 *
 * - Lists the first-party fraud blocklist (canonical lowercase emails) and provides
 *   ban/unban forms posting to /api/admin/banned
 * - Enforcement is server-side and independent of this page: createPendingBid rejects
 *   banned emails before Checkout, and sendOutbidNotification skips them
 * - Distinct from notification_unsubscribes (consent state): banning is a fraud action
 */
export default async function AdminBannedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const listing = await listBannedEmails();

  if (!listing.ok) {
    if (listing.reason === 'unauthorized') {
      redirect('/admin/login');
    }

    redirect('/admin/login');
  }

  const bans = listing.bans;

  const result = typeof params.result === 'string' ? params.result : null;
  const error = typeof params.error === 'string' ? params.error : null;

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? 'admin';

  return (
    <section className="py-12 sm:py-16" aria-label="Fraud and banned email management">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Fraud / banned emails</h1>
            <p className="mt-1 text-sm break-all text-muted-foreground">Signed in as {email}</p>
          </div>
          <Link
            href="/admin"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-5 py-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Back to dashboard
          </Link>
        </div>

        {(result || error) && (
          <p
            role="status"
            className={`mt-6 rounded-lg border px-4 py-3 text-sm ${
              error
                ? 'border-destructive/20 bg-destructive/5 text-destructive'
                : 'border-success/20 bg-success/5 text-foreground'
            }`}
          >
            {error
              ? lookupRecordValue(ERROR_MESSAGES, error, 'Something went wrong. Please try again.')
              : lookupRecordValue(RESULT_MESSAGES, result ?? '', 'Done.')}
          </p>
        )}

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-background p-5">
            <h2 className="text-base font-semibold text-foreground">Ban an email</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Banned addresses cannot place new bids and will not receive outbid notifications.
            </p>
            <form action="/api/admin/banned" method="post" className="mt-4 space-y-4">
              <input type="hidden" name="intent" value="ban" />
              <div>
                <label
                  htmlFor="ban-email"
                  className={
                    inputClasses
                      ? 'block text-xs font-medium uppercase tracking-wide text-muted-foreground'
                      : ''
                  }
                >
                  Email address
                </label>
                <input
                  id="ban-email"
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  className={inputClasses}
                />
              </div>
              <button
                type="submit"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Ban email
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-border bg-background p-5">
            <h2 className="text-base font-semibold text-foreground">Blocklist ({bans.length})</h2>
            {bans.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground" role="status">
                No banned emails.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {bans.map((ban) => (
                  <li
                    key={ban.emailCanonical}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <span className="truncate font-mono text-xs text-foreground">
                      {ban.emailCanonical}
                    </span>
                    <form action="/api/admin/banned" method="post" className="shrink-0">
                      <input type="hidden" name="intent" value="unban" />
                      <input type="hidden" name="email" value={ban.emailCanonical} />
                      <button
                        type="submit"
                        className="inline-flex min-h-11 items-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        Unban
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-8 text-center">
          <Link
            href="/admin"
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}
