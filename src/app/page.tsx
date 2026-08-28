import BidConsole from '@/components/BidConsole';
import LeaderboardTable, { LEADERBOARD_PAGE_SIZE } from '@/components/LeaderboardTable';
import RecentBids from '@/components/RecentBids';
import { getLeaderboard } from '@/lib/bids';
import type { LeaderboardPageEntry } from '@/lib/bids-client';
import { getActiveCategoryOptions } from '@/lib/bids-client';

/**
 * Homepage (UI redesign task): full-screen centered bidding console with the
 * paginated authoritative leaderboard below it.
 *
 * Page 1 of the leaderboard is server-rendered from the SAME authoritative query the
 * rest of the app uses (paid bids, amount DESC, created_at DESC, RLS-filtered), then
 * paginated client-side in bounded 50-row pages. The section keeps the
 * leaderboard-heading anchor that public share URLs target.
 *
 * Query failures are surfaced loudly in the server logs and degrade to an empty page-1
 * (with its explicit empty state) so the bid console always renders - the failure is
 * never silently disguised as "no bids exist".
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category: categorySlug } = await searchParams;
  const selectedCategory = categorySlug ?? null;
  const categories = await getActiveCategoryOptions();

  let initialEntries: LeaderboardPageEntry[] = [];

  try {
    const leaderboard = await getLeaderboard({
      limit: LEADERBOARD_PAGE_SIZE,
      categorySlug: selectedCategory ?? undefined,
    });

    initialEntries = leaderboard.map((entry) => ({
      id: entry.bid.id,
      amount: entry.bid.amount,
      bidderName: entry.bid.bidder_name,
      createdAt: entry.bid.created_at,
      category: entry.category,
      entryTitle: entry.bid.entry_title,
      entryDescription: entry.bid.entry_description,
      entryCanonicalUrl: entry.bid.entry_canonical_url,
      entryImageUrl: entry.bid.entry_image_url,
      entryFaviconUrl: entry.bid.entry_favicon_url,
      entryType: entry.bid.entry_type,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`[home] leaderboard query failed: ${message}`);
  }

  return (
    <>
      <BidConsole />
      <CategoryFilter categories={categories} selectedCategory={selectedCategory} />
      <LeaderboardTable initialEntries={initialEntries} />
      <RecentBids />
    </>
  );
}

function CategoryFilter({
  categories,
  selectedCategory,
}: {
  categories: { slug: string; name: string }[];
  selectedCategory: string | null;
}) {
  const options = [{ slug: 'all', name: 'ALL' }, ...categories];

  return (
    <nav className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8" aria-label="Category filter">
      <div className="flex items-center justify-center gap-2">
        <label htmlFor="category-filter" className="sr-only">
          Filter by category
        </label>
        <select
          id="category-filter"
          value={selectedCategory ?? 'all'}
          onChange={(e) => {
            const value = e.target.value;
            if (value === 'all') {
              window.location.href = '/';
            } else {
              window.location.href = `/?category=${value}`;
            }
          }}
          className="inline-flex h-10 w-auto min-w-[160px] items-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 appearance-none bg-no-repeat bg-right pr-8"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
            backgroundPosition: 'right 0.5rem center',
            backgroundSize: '1.5em 1.5em',
          }}
        >
          {options.map((option) => (
            <option key={option.slug} value={option.slug === 'all' ? '' : option.slug}>
              {option.name}
            </option>
          ))}
        </select>
      </div>
    </nav>
  );
}
