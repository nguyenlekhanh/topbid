/**
 * Canonical public share URL (Tasks 7.2 + 7.3).
 *
 * The homepage leaderboard section is the one established public deep-link destination
 * under current routing (SuccessState's View Leaderboard CTA targets the same anchor):
 * recipients land directly on the public leaderboard where the paid bid is visible.
 *
 * Deliberately NOT /success?session_id=... - the Checkout Session identifier is
 * payment plumbing and must never enter social shares or clipboards. No category
 * route exists yet (Task 7.4 territory), so none is invented here.
 *
 * Pure and deterministic: takes a base URL (the NEXT_PUBLIC_APP_URL convention),
 * normalizes trailing slashes like every other URL builder in this project.
 */
export function buildPublicShareUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/#leaderboard-heading`;
}
