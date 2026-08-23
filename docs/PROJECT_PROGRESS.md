# PROJECT_PROGRESS.md — Current Project State

## Current Phase

**Phase 3 — Bid Engine** (Phase 2 complete)

## Current Task

**3.6 completed** — Next recommended: 3.7

## Completed Tasks

- 0.1: Create Next.js project with TypeScript ✓
- 0.2: Configure TypeScript (strict mode) ✓
- 0.3: Configure Tailwind CSS ✓
- 0.4: Configure ESLint + Prettier ✓
- 0.5: Configure Supabase client ✓
- 0.6: Configure Stripe SDK ✓
- 0.7: Configure environment variables ✓
- 0.8: Configure Git + initial commit ✓
- 0.9: Configure Vercel deployment ✓
- 0.10: Create AGENTS.md and documentation workflow ✓
- 1.1: Global layout (app shell) ✓
- 1.2: Typography and design system ✓
- 1.3: Navbar ✓
- 1.4: Hero section ✓
- 1.5: Category cards grid ✓
- 1.6: Leaderboard ✓
- 1.7: Bid button ✓
- 1.8: Bid modal (email + amount) ✓
- 1.9: Recent bids feed ✓
- 1.10: Empty states ✓
- 1.11: Loading states ✓
- 1.12: Error states ✓
- 1.13: Success state (post-bid) ✓
- 1.14: Responsive mobile design ✓
- 1.15: UI polish (animations, transitions) ✓
- 2.1: Categories schema + migration ✓
- 2.2: Bids schema + migration ✓
- 2.3: Database indexes ✓
- 2.4: Constraints ✓
- 2.5: RLS / security policies ✓
- 2.6: Seed categories ✓
- 2.7: Category queries (list, get) ✓
- 2.8: Highest bid query ✓
- 2.9: Leaderboard query ✓
- 2.10: Recent bids query ✓
- 3.1: Calculate minimum bid (no existing bids) ✓
- 3.2: Calculate minimum bid (existing bids) ✓
- 3.3: Validate bid amount server-side ✓
- 3.4: Validate category server-side ✓
- 3.5: Create pending bid record ✓
- 3.6: Handle concurrent bids (DB locking) ✓

## Tasks in Progress

_None_

## Blocked Tasks

_None_

## Known Bugs

_None_

## Known Technical Debt

_None_

## Current Architecture Status

- Repository initialized with .git
- Documentation structure created
- Next.js project created with TypeScript, App Router, src/ directory
- TypeScript strict mode enabled and verified
- ESLint configured with Prettier integration
- Path aliases (@/*) configured
- Tailwind CSS v4 configured with @import syntax
- Supabase client configured (client & server)
- Stripe SDK configured (client & server)
- Environment variables configured (.env.example, .gitignore)
- Vercel deployment prepared (repository ready)
- AGENTS.md and documentation workflow established
- Global app shell implemented (header/main/footer, full-height layout)
- Typography and design system implemented (colors, typography, spacing, shadows, transitions)
- Navbar component implemented (responsive, accessible, sticky with backdrop blur)
- Hero section implemented (headline, CTAs, value props, responsive)
- Category cards grid implemented (6 mock categories, responsive grid, hover/focus states)
- Leaderboard implemented (top bidders table, #1 emphasis, currency formatting)
- Bid button component implemented (reusable, variants, sizes, loading state, accessible)
- Bid modal implemented (email + amount, mock calculation, accessible dialog, focus trap)
- Recent bids feed implemented (mock 8 bids, amount hierarchy, category pill, time ago, responsive, empty state)
- Empty states implemented (reusable EmptyState + variants for categories/leaderboard/bids, integrated with conditional rendering)
- Loading states implemented (reusable Skeleton + 5 variants matching loaded layouts, motion-safe, aria-busy)
- Error states implemented (reusable ErrorState + 6 variants, card/inline, user-friendly, Retry, alert live)
- Success state implemented (reusable SuccessState with amount/category/reference, mock demo disclaimer, View Leaderboard/Continue Browsing, motion-safe)
- Responsive mobile design audited and refined (320/375/390/430 verified, overflow fixed, touch targets 44px, tables/cards/modals readable)
- UI polish applied (subtle animations: fadeInUp, slideDown, scaleIn, lift/shadow, underline, motion-safe)
- Categories schema migration created (UUID PK, slug unique, integer cents, timestamps, pgcrypto guard)
- Bids schema migration created (UUID PK, FK to categories ON DELETE CASCADE, integer cents, stripe_session_id UNIQUE + composite unique, status pending, is_highest, timestamps)
- Database indexes migration created (4 bids indexes, partial status='paid' with DESC preserved, stripe_session redundancy documented)
- Constraints migration created (4 CHECKs: starting_bid/increment/amount >=0, status IN, justified, allow 0)
- RLS migration created (RLS enabled on categories/bids, public SELECT active categories and paid bids only, no public writes, service_role bypass)
- Seed categories migration created (6 active MVP categories, idempotent ON CONFLICT DO NOTHING, integer cents, preserved UI slugs)
- Category queries created (typed listCategories/getCategoryBySlug via server client, RLS active-only, is_active enforced, not-found handled)
- Highest bid query created (getHighestBidForCategory via server client, RLS paid-only, amount DESC limit 1)
- Leaderboard query created (getLeaderboard: paid bids ranked amount DESC + created_at tie-breaker, embedded category info, optional limit default 10)
- Recent bids query created (getRecentBids: newest-first paid bids, created_at DESC + amount tie-breaker, bidder and embedded category info, optional limit default 10)
- Minimum bid calculation created (getInitialMinimumBid: no-existing-paid-bids rule minimum = starting_bid, composes getCategoryBySlug + getHighestBidForCategory, null for missing/inactive/existing-bid cases)
- Existing-bid minimum calculation created (getIncrementedMinimumBid: minimum = highest paid bid amount + category increment, composes getCategoryBySlug + getHighestBidForCategory, null for missing/inactive/no-paid-bid cases)
- Server-side bid amount validation created (getMinimumBidForCategory unified authoritative minimum resolver + validateBidAmount with untrusted-amount runtime guards, discriminated-union result, equality-to-minimum accepted)
- Server-side category validation created (validateCategory in categories.ts: untrusted slug runtime guards, authoritative DB-sourced row via getCategoryBySlug, active-only enforced by app filter + RLS, predictable invalid_slug/category_not_found reasons)
- Pending bid record creation created (createPendingBid in bids.ts: composes validateCategory + validateBidAmount, service-role write via new server-only supabase-service.ts, explicit status='pending', DB-sourced category_id, typed failure union with 4.1-ready contract)
- Concurrent bid handling created (create_pending_bid PL/pgSQL RPC via migration 20260823000007: SELECT FOR UPDATE on the category row serializes same-category critical sections, pending-aware minimum floor recomputed inside the lock, EXECUTE restricted to service_role; createPendingBid switched to the RPC with unchanged external contract)

## Current Environment/Setup Status

- Node.js: v20.18.3 ✓
- npm: 11.19.0 ✓
- Next.js: 16.3.2 ✓
- React: 19.2.8 ✓
- TypeScript: 5.x ✓
- Tailwind CSS: v4 ✓
- Prettier: 3.9.6 ✓
- Supabase: Configured ✓
- Stripe: Configured ✓
- Vercel: Prepared (requires manual connection by owner)
- Environment variables: .env.example created ✓

## Next Recommended Task

**3.7 — Prevent duplicate transactions**

## Notes

Phase 1 (UI/Design) is now complete.
Phase 2 (Database queries) is now complete.

Task 2.8 completed successfully. Highest-bid query created in src/lib/bids.ts via server client, RLS paid-only, amount DESC limit 1, maybeSingle null handling.

Task 2.9 completed successfully. Leaderboard query added to src/lib/bids.ts returning paid bids ranked amount DESC with created_at tie-breaker, embedded category info, and optional limit (default 10).

Task 2.10 completed successfully. Recent-bids query added to src/lib/bids.ts returning newest-first paid bids with created_at DESC + amount tie-breaker, bidder and embedded category info, and optional limit (default 10). Purely additive to Task 2.9 code.

Task 3.1 completed successfully. getInitialMinimumBid added to src/lib/bids.ts: server-side minimum = starting_bid for categories with no paid bids; composes getCategoryBySlug + getHighestBidForCategory; returns null for missing/inactive categories and defers existing-bid minimums to Task 3.2.

Task 3.2 completed successfully. getIncrementedMinimumBid added to src/lib/bids.ts: server-side minimum = highest paid bid amount + category.increment for categories with existing paid bids; mirrors Task 3.1 conventions with complementary null contract; all amounts sourced from DB, never client input.

Task 3.3 completed successfully. Server-side amount validation added to src/lib/bids.ts: getMinimumBidForCategory resolves the authoritative minimum (starting_bid or highest+increment) in one query pass and validateBidAmount validates untrusted client amounts against it (runtime shape guards, below-minimum rejection, equality accepted).

Task 3.4 completed successfully. validateCategory added to src/lib/categories.ts: authoritative DB-sourced category validation with untrusted-slug runtime guards; active-only enforced by app-level filter + RLS; predictable invalid_slug/category_not_found failure reasons; no service-role usage.

Task 3.5 completed successfully. createPendingBid added to src/lib/bids.ts: validates category + amount authoritatively, then inserts a bids row with explicit status='pending' via the new server-only service-role client (src/lib/supabase-service.ts); typed failure union documented as the Task 4.1 Stripe Checkout contract; concurrency/duplicate handling deferred to Tasks 3.6/3.7.

Task 3.6 completed successfully. Concurrency-safe reservation added: migration 20260823000007 introduces create_pending_bid RPC (SELECT FOR UPDATE on the category row, pending-aware minimum recheck, insert) restricted to service_role; createPendingBid now calls the RPC so same-category critical sections serialize at the database level while different categories proceed concurrently. Live concurrency testing skipped (no local Docker), documented honestly.
