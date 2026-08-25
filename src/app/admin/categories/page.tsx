import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  listAllCategoriesForAdmin,
  type CategoryManagementErrorReason,
} from '@/lib/admin-category-management';
import { NO_INDEX } from '@/lib/seo';
import { lookupRecordValue } from '@/lib/safe-lookup';
import { createClient } from '@/lib/supabase-server';

// Task 10.5: private admin surface - never indexed.
export const metadata: Metadata = {
  ...NO_INDEX,
  title: 'Category management — Topbid.lol',
};

const RESULT_MESSAGES: Record<string, string> = {
  created: 'Category created.',
  updated: 'Category updated.',
  activated: 'Category activated.',
  deactivated: 'Category deactivated.',
};

const ERROR_MESSAGES: Record<CategoryManagementErrorReason, string> = {
  unauthorized: 'You are not authorized to manage categories.',
  invalid_input: 'The submitted values were invalid. Please review and retry.',
  slug_taken: 'That slug is already in use by another category.',
  not_found: 'The targeted category no longer exists.',
  db_error: 'A database error occurred. Please try again.',
};

const inputClasses =
  'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
const labelClasses = 'block text-xs font-medium uppercase tracking-wide text-muted-foreground';
const buttonPrimary =
  'inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/**
 * Category management (Task 8.3).
 *
 * - Authorization flows through the Task 8.1 boundary via listAllCategoriesForAdmin
 *   and the mutation endpoint (which re-checks server-side); unauthenticated/
 *   non-admin visitors are redirected before any data renders
 * - Lists ALL categories including inactive ones (public RLS hides those; this page
 *   uses the isolated service-role read behind the same authorization gate)
 * - Create / edit / activate / deactivate forms post to the single mutations endpoint
 * - Slug is immutable after creation - public category URLs must stay stable
 */
export default async function AdminCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const listing = await listAllCategoriesForAdmin();

  if (!listing.ok) {
    if (listing.reason === 'unauthorized') {
      redirect('/admin/login');
    }

    // Fail closed without leaking raw database errors.
    redirect('/admin/login');
  }

  const categories = listing.categories;
  const result = typeof params.result === 'string' ? params.result : null;
  const error = typeof params.error === 'string' ? params.error : null;

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? 'admin';

  return (
    <section className="py-12 sm:py-16" aria-label="Category management">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Category management</h1>
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
            <h2 className="text-base font-semibold text-foreground">Create category</h2>
            <form action="/api/admin/categories" method="post" className="mt-4 space-y-4">
              <input type="hidden" name="intent" value="create" />
              <div>
                <label htmlFor="create-slug" className={labelClasses}>
                  Slug (URL identifier, immutable after creation)
                </label>
                <input
                  id="create-slug"
                  name="slug"
                  required
                  maxLength={80}
                  className={inputClasses}
                />
              </div>
              <div>
                <label htmlFor="create-name" className={labelClasses}>
                  Name
                </label>
                <input
                  id="create-name"
                  name="name"
                  required
                  maxLength={120}
                  className={inputClasses}
                />
              </div>
              <div>
                <label htmlFor="create-description" className={labelClasses}>
                  Description (optional)
                </label>
                <textarea
                  id="create-description"
                  name="description"
                  rows={2}
                  maxLength={500}
                  className={inputClasses}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="create-starting-bid" className={labelClasses}>
                    Starting bid ($)
                  </label>
                  <input
                    id="create-starting-bid"
                    name="starting_bid"
                    inputMode="decimal"
                    placeholder="100"
                    required
                    className={inputClasses}
                  />
                </div>
                <div>
                  <label htmlFor="create-increment" className={labelClasses}>
                    Bid increment ($)
                  </label>
                  <input
                    id="create-increment"
                    name="increment"
                    inputMode="decimal"
                    placeholder="10"
                    required
                    className={inputClasses}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="create-image-url" className={labelClasses}>
                  Image URL (optional)
                </label>
                <input id="create-image-url" name="image_url" type="url" className={inputClasses} />
              </div>
              <button type="submit" className={`${buttonPrimary} w-full`}>
                Create category
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-border bg-background p-5">
            <h2 className="text-base font-semibold text-foreground">
              All categories ({categories.length})
            </h2>
            {categories.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground" role="status">
                No categories exist yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {categories.map((category) => (
                  <li key={category.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <span className="font-semibold text-foreground">{category.name}</span>{' '}
                        <span className="text-xs text-muted-foreground">/{category.slug}</span>{' '}
                        <span
                          className={`ml-1 rounded-full px-2 py-0.5 text-xs ${
                            category.is_active
                              ? 'bg-success/10 text-foreground'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {category.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <form action="/api/admin/categories" method="post">
                        <input type="hidden" name="intent" value="set_active" />
                        <input type="hidden" name="id" value={category.id} />
                        <input type="hidden" name="active" value={String(!category.is_active)} />
                        <button
                          type="submit"
                          className="inline-flex min-h-9 items-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          {category.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </form>
                    </div>

                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium text-primary">
                        Edit details
                      </summary>
                      <form action="/api/admin/categories" method="post" className="mt-3 space-y-3">
                        <input type="hidden" name="intent" value="update" />
                        <input type="hidden" name="id" value={category.id} />
                        <div>
                          <label htmlFor={`name-${category.id}`} className={labelClasses}>
                            Name
                          </label>
                          <input
                            id={`name-${category.id}`}
                            name="name"
                            defaultValue={category.name}
                            maxLength={120}
                            required
                            className={inputClasses}
                          />
                        </div>
                        <div>
                          <label htmlFor={`description-${category.id}`} className={labelClasses}>
                            Description
                          </label>
                          <textarea
                            id={`description-${category.id}`}
                            name="description"
                            rows={2}
                            defaultValue={category.description ?? ''}
                            maxLength={500}
                            className={inputClasses}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label htmlFor={`starting-${category.id}`} className={labelClasses}>
                              Starting bid ($)
                            </label>
                            <input
                              id={`starting-${category.id}`}
                              name="starting_bid"
                              inputMode="decimal"
                              defaultValue={(category.starting_bid / 100).toString()}
                              className={inputClasses}
                            />
                          </div>
                          <div>
                            <label htmlFor={`increment-${category.id}`} className={labelClasses}>
                              Bid increment ($)
                            </label>
                            <input
                              id={`increment-${category.id}`}
                              name="increment"
                              inputMode="decimal"
                              defaultValue={(category.increment / 100).toString()}
                              className={inputClasses}
                            />
                          </div>
                        </div>
                        <div>
                          <label htmlFor={`image-${category.id}`} className={labelClasses}>
                            Image URL
                          </label>
                          <input
                            id={`image-${category.id}`}
                            name="image_url"
                            type="url"
                            defaultValue={category.image_url ?? ''}
                            className={inputClasses}
                          />
                        </div>
                        <button type="submit" className={buttonPrimary}>
                          Save changes
                        </button>
                      </form>
                    </details>
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
