import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getAdminAuthorization } from '@/lib/admin-auth';
import { createClient } from '@/lib/supabase-server';

export const metadata: Metadata = {
  title: 'Admin — Topbid.lol',
};

/**
 * Admin entry boundary (Task 8.1).
 *
 * - The ONLY page in the /admin family; it exists so the reusable server-side guard
 *   has a real, enforced protected route and future Phase 8 tasks (8.2+) have a
 *   canonical place to mount management UI behind getAdminAuthorization()
 * - Unauthenticated/unauthorized visitors are redirected to the login page
 *   server-side before any content renders - this is enforcement, not UI hiding
 * - Deliberately NOT a dashboard (Tasks 8.2-8.8 own that functionality)
 */
export default async function AdminPage() {
  const authorization = await getAdminAuthorization();

  if (!authorization.authorized) {
    redirect('/admin/login');
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? 'admin';

  return (
    <section className="py-12 sm:py-16" aria-label="Admin">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl rounded-xl border border-border bg-background px-6 py-10 text-center sm:px-8">
          <h1 className="text-base sm:text-lg font-semibold text-foreground">
            Admin access verified
          </h1>
          <p className="mt-2 text-sm break-all text-muted-foreground">Signed in as {email}</p>

          <form action="/api/admin/logout" method="post" className="mt-6">
            <button
              type="submit"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
