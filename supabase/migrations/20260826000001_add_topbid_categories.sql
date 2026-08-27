-- Migration: add Topbid.lol category taxonomy expansion
-- Task: Expand category taxonomy with 31 new categories for bidding on public websites, products, companies, projects, creators, domains, and online properties.
--
-- Existing categories (must remain unchanged):
--   art, tech, fashion, sports, automotive, crypto
--
-- New categories use ON CONFLICT (slug) DO NOTHING for idempotency.
-- Existing rows are not modified.

insert into public.categories (slug, name, description, starting_bid, increment, is_active, image_url)
values
  ('ai-ml', 'AI & Machine Learning', 'AI models, machine learning platforms, and intelligent systems.', 10000, 1000, true, null),
  ('ai-agents', 'AI Agents', 'Autonomous agents, agentic workflows, and AI-powered automation.', 10000, 1000, true, null),
  ('generative-media', 'Generative Media', 'Generative AI for images, video, audio, and creative content.', 10000, 1000, true, null),
  ('developer-tools', 'Developer Tools', 'IDEs, CLI tools, debugging, testing, and developer productivity.', 10000, 1000, true, null),
  ('cloud-infrastructure', 'Cloud & Infrastructure', 'Cloud platforms, hosting, infrastructure, DevOps, and deployment.', 10000, 1000, true, null),
  ('open-source', 'Open Source', 'Open source projects, libraries, frameworks, and communities.', 5000, 500, true, null),
  ('data-analytics', 'Data & Analytics', 'Data platforms, analytics, BI, dashboards, and data services.', 10000, 1000, true, null),
  ('cybersecurity', 'Cybersecurity', 'Security products, privacy tools, compliance, and threat intelligence.', 10000, 1000, true, null),
  ('automation', 'Automation', 'Workflow automation, integrations, RPA, and productivity automation.', 10000, 1000, true, null),
  ('browser-extensions', 'Browser Extensions', 'Browser extensions, plugins, add-ons, and web utilities.', 5000, 500, true, null),
  ('mobile-apps', 'Mobile Apps', 'iOS, Android, and cross-platform mobile applications.', 10000, 1000, true, null),
  ('saas', 'SaaS', 'Software-as-a-Service products and online software platforms.', 10000, 1000, true, null),
  ('ecommerce', 'Ecommerce', 'Online stores, retail platforms, shopping technology, and ecommerce brands.', 10000, 1000, true, null),
  ('marketplaces', 'Marketplaces', 'Two-sided marketplaces, exchange platforms, and online commerce networks.', 10000, 1000, true, null),
  ('finance-fintech', 'Finance & Fintech', 'Financial services, payments, banking, investing, and fintech.', 10000, 1000, true, null),
  ('business-services', 'Business Services', 'B2B services, consulting, agencies, and professional services.', 10000, 1000, true, null),
  ('sales-crm', 'Sales & CRM', 'Sales platforms, CRM systems, prospecting, and customer management.', 10000, 1000, true, null),
  ('marketing-growth', 'Marketing & Growth', 'Marketing platforms, SEO, advertising, analytics, and growth tools.', 10000, 1000, true, null),
  ('real-estate', 'Real Estate', 'Property platforms, real estate businesses, REITs, and proptech.', 50000, 5000, true, null),
  ('creators-influencers', 'Creators & Influencers', 'Creators, influencers, personal brands, and creator businesses.', 5000, 500, true, null),
  ('social-communities', 'Social & Communities', 'Social platforms, online communities, forums, and networks.', 5000, 500, true, null),
  ('content-publishing', 'Content & Publishing', 'Blogs, newsletters, publishing platforms, and digital publications.', 5000, 500, true, null),
  ('design-creative', 'Design & Creative', 'Design tools, creative services, visual assets, and creative businesses.', 10000, 1000, true, null),
  ('audio-podcasts', 'Audio & Podcasts', 'Podcasts, audio platforms, music-related tools, and audio businesses.', 5000, 500, true, null),
  ('video-media', 'Video & Media', 'Video platforms, streaming services, production tools, and media businesses.', 10000, 1000, true, null),
  ('news-information', 'News & Information', 'News websites, information services, research platforms, and media outlets.', 5000, 500, true, null),
  ('domains-websites', 'Domains & Websites', 'Domain names, websites, web properties, and online real estate.', 10000, 1000, true, null),
  ('education', 'Education', 'Education platforms, courses, EdTech, learning tools, and training.', 5000, 500, true, null),
  ('health-wellness', 'Health & Wellness', 'Health technology, wellness platforms, fitness, and wellbeing services.', 10000, 1000, true, null),
  ('travel', 'Travel', 'Travel platforms, booking services, destinations, and travel businesses.', 10000, 1000, true, null),
  ('food-restaurants', 'Food & Restaurants', 'Restaurants, food businesses, delivery platforms, and food technology.', 10000, 1000, true, null),
  ('games-entertainment', 'Games & Entertainment', 'Games, gaming platforms, entertainment businesses, and interactive media.', 10000, 1000, true, null),
  ('organizations-nonprofits', 'Organizations & Nonprofits', 'Nonprofits, NGOs, communities, organizations, and mission-driven projects.', 5000, 500, true, null),
  ('events', 'Events', 'Conferences, meetups, events, ticketing, and event businesses.', 5000, 500, true, null),
  ('other', 'Other', 'Public entries that do not fit another category.', 1000, 100, true, null)
on conflict (slug) do nothing;