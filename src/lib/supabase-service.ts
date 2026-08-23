import { createClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client using the service role key (bypasses RLS).
 * - SUPABASE_SERVICE_ROLE_KEY is a server-only environment variable (no NEXT_PUBLIC_
 *   prefix); it must never be imported from client components or exposed to the browser
 * - Used exclusively for trusted server-side write operations, per AGENTS.md:
 *   "Service role for writes - Client never writes directly to DB"
 *   (RLS grants public SELECT only; there are intentionally no public write policies)
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase service configuration: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
