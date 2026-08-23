-- Migration: seed initial categories
-- Task 2.6 — Seed categories
-- MVP categories matching Phase 1 UI mock data, idempotent via slug

insert into public.categories (slug, name, description, starting_bid, increment, is_active, image_url)
values
  ('art', 'Art & Collectibles', 'Bid on rare artwork, sculptures, and limited edition collectibles.', 50000, 5000, true, null),
  ('tech', 'Tech & Gadgets', 'Latest smartphones, laptops, and cutting-edge electronics.', 20000, 2000, true, null),
  ('fashion', 'Fashion & Accessories', 'Designer clothing, watches, jewelry, and luxury accessories.', 30000, 3000, true, null),
  ('sports', 'Sports Memorabilia', 'Signed jerseys, game-used equipment, and historic sports artifacts.', 15000, 1500, true, null),
  ('automotive', 'Automotive', 'Classic cars, motorcycles, and automotive collectibles.', 100000, 10000, true, null),
  ('crypto', 'Digital Assets', 'NFTs, domain names, and blockchain-based collectibles.', 10000, 1000, true, null)
on conflict (slug) do nothing;
