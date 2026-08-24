import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Admin login — Topbid.lol',
};

function sanitizeNext(value: string | string[] | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }

  // Mirrors the server-side guard: same-origin relative paths only.
  return value.startsWith('/') && !value.startsWith('//') ? value : '';
}

/**
 * Minimal admin login page (Task 8.1).
 *
 * - Plain credentials form posting to /api/admin/login (progressive enhancement, no
 *   client-side JS required); failures return here with a generic ?error=1 flag that
 *   never reveals whether an email/account exists
 * - A `next` parameter may pre-select the post-login destination; it is re-validated
 *   server-side on submit (open-redirect protection lives there, mirrored here only
 *   to keep the hidden field sane)
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = sanitizeNext(params.next);
  const failed = params.error === '1';

  return (
    <section className="py-12 sm:py-16" aria-label="Admin login">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-md rounded-xl border border-border bg-background px-6 py-10 sm:px-8">
          <h1 className="text-base sm:text-lg font-semibold text-foreground">Admin sign in</h1>
          <p className="mt-2 text-sm text-muted-foreground">Authorized administrators only.</p>

          {failed && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              Sign-in failed. Check your credentials and try again.
            </p>
          )}

          <form action="/api/admin/login" method="post" className="mt-6 space-y-4">
            {next && <input type="hidden" name="next" value={next} />}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={320}
                className="mt-1 w-full min-h-11 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={320}
                className="mt-1 w-full min-h-11 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            <button
              type="submit"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Sign in
            </button>
          </form>
        </div>

        <div className="mx-auto mt-6 max-w-md text-center">
          <Link
            href="/"
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
          >
            Back to Topbid.lol
          </Link>
        </div>
      </div>
    </section>
  );
}
