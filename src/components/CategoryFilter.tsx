'use client';

import { useRouter } from 'next/navigation';

export type CategoryOption = { slug: string; name: string };

interface CategoryFilterProps {
  categories: CategoryOption[];
  selectedCategory: string | null;
}

export default function CategoryFilter({ categories, selectedCategory }: CategoryFilterProps) {
  const router = useRouter();
  const options = [{ slug: 'all', name: 'ALL' }, ...categories];

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    if (value === 'all' || value === '') {
      router.push('/');
    } else {
      router.push(`/?category=${encodeURIComponent(value)}`);
    }
  }

  return (
    <nav className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8" aria-label="Category filter">
      <div className="flex items-center justify-center gap-2">
        <label htmlFor="category-filter" className="sr-only">
          Filter by category
        </label>
        <select
          id="category-filter"
          value={selectedCategory ?? 'all'}
          onChange={handleChange}
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
