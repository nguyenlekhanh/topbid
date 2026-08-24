import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

/**
 * Admin logout endpoint (Task 8.1).
 *
 * - Signs the session out server-side through Supabase Auth (clearing the
 *   @supabase/ssr session cookies) and returns to the login page
 * - Always succeeds from the user's perspective: sign-out errors are not
 *   distinguishable from an already-ended session, and the response is identical
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  await supabase.auth.signOut();

  return NextResponse.redirect(new URL('/admin/login', new URL(request.url)), 303);
}
