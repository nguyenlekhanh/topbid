'use client';

import BidButton from '@/components/BidButton';

interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  startingBid: number;
  increment: number;
  imageUrl?: string;
  currentHighestBid?: number;
  bidCount: number;
}

const mockCategories: Category[] = [
  {
    id: '1',
    slug: 'art',
    name: 'Art & Collectibles',
    description: 'Bid on rare artwork, sculptures, and limited edition collectibles.',
    startingBid: 50000,
    increment: 5000,
    currentHighestBid: 125000,
    bidCount: 23,
  },
  {
    id: '2',
    slug: 'tech',
    name: 'Tech & Gadgets',
    description: 'Latest smartphones, laptops, and cutting-edge electronics.',
    startingBid: 20000,
    increment: 2000,
    currentHighestBid: 45000,
    bidCount: 18,
  },
  {
    id: '3',
    slug: 'fashion',
    name: 'Fashion & Accessories',
    description: 'Designer clothing, watches, jewelry, and luxury accessories.',
    startingBid: 30000,
    increment: 3000,
    currentHighestBid: 78000,
    bidCount: 31,
  },
  {
    id: '4',
    slug: 'sports',
    name: 'Sports Memorabilia',
    description: 'Signed jerseys, game-used equipment, and historic sports artifacts.',
    startingBid: 15000,
    increment: 1500,
    currentHighestBid: 52000,
    bidCount: 14,
  },
  {
    id: '5',
    slug: 'automotive',
    name: 'Automotive',
    description: 'Classic cars, motorcycles, and automotive collectibles.',
    startingBid: 100000,
    increment: 10000,
    currentHighestBid: 250000,
    bidCount: 8,
  },
  {
    id: '6',
    slug: 'crypto',
    name: 'Digital Assets',
    description: 'NFTs, domain names, and blockchain-based collectibles.',
    startingBid: 10000,
    increment: 1000,
    currentHighestBid: 35000,
    bidCount: 42,
  },
];

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default function CategoryCards() {
  return (
    <section className="py-12 sm:py-16 lg:py-20" aria-labelledby="categories-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="text-center max-w-2xl mx-auto mb-12">
          <h2
            id="categories-heading"
            className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight"
          >
            Categories to Bid On
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Explore active categories and place your bid to reach the top spot.
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" role="list">
          {mockCategories.map((category) => (
            <article
              key={category.id}
              className="group relative flex flex-col rounded-xl border border-border bg-background p-6 transition-all duration-300 hover:shadow-lg hover:border-primary/50 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
              role="listitem"
            >
              <div
                className="absolute inset-0 bg-gradient-to-t from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl pointer-events-none"
                aria-hidden="true"
              />

              <div className="relative flex flex-col flex-1">
                <div className="mb-4">
                  <h3 className="text-xl font-semibold text-foreground group-hover:text-primary transition-colors">
                    {category.name}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                    {category.description}
                  </p>
                </div>

                <div className="flex flex-col gap-3 mt-auto pt-4 border-t border-border">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Current Bid</div>
                      <div className="font-semibold text-foreground">
                        {formatCurrency(category.currentHighestBid ?? category.startingBid)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Total Bids</div>
                      <div className="font-semibold text-primary">{category.bidCount}</div>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Starting: {formatCurrency(category.startingBid)} • Increment:{' '}
                    {formatCurrency(category.increment)}
                  </div>

                  <BidButton
                    variant="primary"
                    size="md"
                    onClick={() => {
                      window.location.href = `/category/${category.slug}`;
                    }}
                    aria-label={`Place bid on ${category.name}`}
                  >
                    Place Bid
                    <svg
                      className="h-4 w-4 transition-transform group-hover:translate-x-1"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 8l4 4m0 0l-4 4m4-4H3"
                      />
                    </svg>
                  </BidButton>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-12 text-center">
          <a
            href="/categories"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-6 py-3 text-foreground font-medium text-base transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            View All Categories
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 8l4 4m0 0l-4 4m4-4H3"
              />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
