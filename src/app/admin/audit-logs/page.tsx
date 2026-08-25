import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { readAuditLogs, type AuditLogRow } from '@/lib/audit-log';
import { NO_INDEX } from '@/lib/seo';

import { createClient } from '@/lib/supabase-server';

// Task 10.5: private admin surface - never indexed.
export const metadata: Metadata = {
  ...NO_INDEX,
  title: 'Audit logs — Topbid.lol',
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatDetail(detail: unknown): string | null {
  if (detail === null || detail === undefined) {
    return null;
  }

  const serialized = JSON.stringify(detail);

  return serialized.length > 200 ? `${serialized.slice(0, 197)}...` : serialized;
}

/**
 * Admin audit-log page (Task 8.8).
 *
 * - Authorization first via getAdminAuthorization inside readAuditLogs; unauthorized
 *   visitors are redirected to login before any data renders
 * - Newest-first bounded list (latest 100 records) of administrative mutations:
 *   who (actor email), what (action), on what target, and structured detail context
 * - Read-only surface; no filtering/search/pagination infrastructure
 */
export default async function AdminAuditLogsPage() {
  const listing = await readAuditLogs();

  if (!listing.ok) {
    redirect('/admin/login');
  }

  const entries: AuditLogRow[] = listing.ok ? listing.entries : [];

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? 'admin';

  return (
    <section className="py-12 sm:py-16" aria-label="Audit logs">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Audit logs</h1>
            <p className="mt-1 text-sm break-all text-muted-foreground">
              Signed in as {email} · latest {entries.length} record
              {entries.length === 1 ? '' : 's'}
            </p>
          </div>
          <Link
            href="/admin"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-5 py-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Back to dashboard
          </Link>
        </div>

        <div className="mt-8 rounded-xl border border-border bg-background p-5">
          {entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground" role="status">
              No audit records yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((entry) => (
                <li key={entry.id} className="py-3">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-mono text-xs font-medium text-primary">
                      {entry.action}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatTimestamp(entry.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    actor: {entry.actorEmail} · target:{' '}
                    {entry.targetType && entry.targetId
                      ? `${entry.targetType}/${entry.targetId}`
                      : 'n/a'}
                  </p>
                  {formatDetail(entry.detail) && (
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      {formatDetail(entry.detail)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
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
