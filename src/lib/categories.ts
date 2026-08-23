import { createClient } from '@/lib/supabase-server';

export type Category = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  starting_bid: number;
  increment: number;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const CATEGORY_FIELDS =
  'id, slug, name, description, starting_bid, increment, image_url, is_active, created_at, updated_at';

export async function listCategories(): Promise<Category[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('categories')
    .select(CATEGORY_FIELDS)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to list categories: ${error.message}`);
  }

  return (data as Category[]) ?? [];
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  if (!slug || typeof slug !== 'string') {
    return null;
  }

  const normalized = slug.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('categories')
    .select(CATEGORY_FIELDS)
    .eq('slug', normalized)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch category "${normalized}": ${error.message}`);
  }

  return (data as Category | null) ?? null;
}
