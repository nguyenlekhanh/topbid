import { NextResponse } from 'next/server';

import {
  createAdminCategory,
  setCategoryActive,
  updateAdminCategory,
} from '@/lib/admin-category-management';

export const runtime = 'nodejs';

/**
 * Category-management mutations endpoint (Task 8.3).
 *
 * - Single POST surface with an `intent` discriminator: create | update | set_active
 * - Authorization is enforced INSIDE every management function (Task 8.1 boundary);
 *   unauthorized results redirect to the login page exactly like protected pages
 * - Outcomes are surfaced as redirects back to /admin/categories with stable flags:
 *   ?result=created|updated|activated|deactivated on success,
 *   ?error=<reason> (unauthorized|invalid_input|slug_taken|not_found|db_error) otherwise
 * - 303 redirects keep one rendering surface (the management page)
 */
function redirectTo(requestUrl: URL, params: Record<string, string>): NextResponse {
  const destination = new URL('/admin/categories', requestUrl);

  for (const [key, value] of Object.entries(params)) {
    destination.searchParams.set(key, value);
  }

  return NextResponse.redirect(destination, 303);
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return redirectTo(requestUrl, { error: 'invalid_input' });
  }

  // Absent keys become undefined so management functions see their documented
  // optional-input semantics (null would mean an explicit clear/override).
  const field = (name: string): string | undefined => {
    const value = form.get(name);

    return typeof value === 'string' ? value : undefined;
  };

  const intent = String(form.get('intent') ?? '');

  if (intent === 'create') {
    const result = await createAdminCategory({
      slug: field('slug'),
      name: field('name'),
      description: field('description'),
      startingBid: field('starting_bid'),
      increment: field('increment'),
      imageUrl: field('image_url'),
    });

    return result.ok
      ? redirectTo(requestUrl, { result: 'created' })
      : redirectTo(requestUrl, { error: result.reason });
  }

  if (intent === 'update') {
    const result = await updateAdminCategory({
      id: field('id'),
      name: field('name'),
      description: field('description'),
      startingBid: field('starting_bid'),
      increment: field('increment'),
      imageUrl: field('image_url'),
    });

    return result.ok
      ? redirectTo(requestUrl, { result: 'updated' })
      : redirectTo(requestUrl, { error: result.reason });
  }

  if (intent === 'set_active') {
    const result = await setCategoryActive({
      id: field('id'),
      active: field('active'),
    });

    if (!result.ok) {
      return redirectTo(requestUrl, { error: result.reason });
    }

    return redirectTo(requestUrl, {
      result: String(form.get('active')) === 'false' ? 'deactivated' : 'activated',
    });
  }

  return redirectTo(requestUrl, { error: 'invalid_input' });
}
