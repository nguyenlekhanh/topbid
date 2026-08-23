# PROJECT_PLAN.md — Topbid.lol Master Development Roadmap

## Product Overview

Topbid.lol is a simple public bidding/leaderboard website where users bid on categories and compete for the top spot. The core concept: users choose a category, click BID, the system calculates the minimum valid bid based on current highest paid bid (or starting bid), user pays via Stripe, and only after verified webhook confirmation does the bid become valid and update the leaderboard.

## Goals

- Build a minimal, premium-feeling bidding platform
- Server-side bid calculation and validation (never trust client)
- Secure Stripe integration with webhook verification
- Real-time leaderboard updates
- Viral sharing mechanics for winners
- No user accounts required for MVP

## Non-Goals

- User registration/authentication (MVP)
- Complex admin features (Phase 8+)
- Multiple payment providers
- Auction-style bidding (this is simple incremental bidding)
- Mobile app (web only)

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│  Next.js    │────▶│  Supabase   │
│  (Browser)  │     │  API Routes │     │  (PostgreSQL)│
└─────────────┘     └─────────────┘     └─────────────┘
       ▲                   │                    │
       │                   ▼                    │
       │            ┌─────────────┐             │
       └───────────▶│   Stripe    │             │
                    │  (Payments) │             │
                    └─────────────┘             │
                          │                     │
                          ▼                     │
                    ┌─────────────┐             │
                    │  Webhooks   │─────────────┘
                    └─────────────┘
```

## Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14+ (App Router) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS |
| Database | Supabase / PostgreSQL |
| Payments | Stripe (Checkout + Webhooks) |
| Deployment | Vercel |
| Email (future) | Resend |
| Analytics (future) | PostHog |

## Database Design

### Tables

#### categories
```sql
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  starting_bid INTEGER NOT NULL DEFAULT 100, -- in cents
  increment INTEGER NOT NULL DEFAULT 100,    -- in cents
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### bids
```sql
CREATE TABLE bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL, -- in cents
  bidder_email TEXT NOT NULL,
  bidder_name TEXT,
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'paid', 'failed', 'refunded'
  is_highest BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  UNIQUE(category_id, stripe_session_id)
);
```

### Indexes
- `idx_bids_category_status` ON bids(category_id, status)
- `idx_bids_category_paid_amount` ON bids(category_id, amount DESC) WHERE status = 'paid'
- `idx_bids_stripe_session` ON bids(stripe_session_id)
- `idx_bids_payment_intent` ON bids(stripe_payment_intent_id)

### Row Level Security (RLS)
- Public read access to categories (active only)
- Public read access to paid bids for leaderboard
- Service role for all write operations
- No user-specific policies needed (no auth in MVP)

## Security Principles

1. **Never trust client input** — All bid amounts calculated server-side
2. **Verify Stripe webhooks** — Check signatures, idempotency keys
3. **Service role for writes** — Client never writes directly to DB
4. **Input validation** — Zod schemas on all API routes
5. **Rate limiting** — On bid creation endpoints
6. **HTTPS only** — Enforced by Vercel

## Development Phases

### Phase 0 — Project Setup
| Task | Description | Dependencies |
|------|-------------|--------------|
| 0.1 | Create Next.js project with TypeScript | - |
| 0.2 | Configure TypeScript (strict mode) | 0.1 |
| 0.3 | Configure Tailwind CSS | 0.1 |
| 0.4 | Configure ESLint + Prettier | 0.1 |
| 0.5 | Configure Supabase client | 0.1 |
| 0.6 | Configure Stripe SDK | 0.1 |
| 0.7 | Configure environment variables | 0.1 |
| 0.8 | Configure Git + initial commit | 0.1 |
| 0.9 | Configure Vercel deployment | 0.1 |
| 0.10 | Create AGENTS.md and documentation workflow | 0.1 |

### Phase 1 — UI / Design (Mock Data)
| Task | Description | Dependencies |
|------|-------------|--------------|
| 1.1 | Global layout (app shell) | 0.10 |
| 1.2 | Typography and design system | 1.1 |
| 1.3 | Navbar | 1.1 |
| 1.4 | Hero section | 1.1 |
| 1.5 | Category cards grid | 1.2 |
| 1.6 | Leaderboard component | 1.2 |
| 1.7 | Bid button | 1.2 |
| 1.8 | Bid modal (email + amount) | 1.7 |
| 1.9 | Recent bids feed | 1.2 |
| 1.10 | Empty states | 1.5 |
| 1.11 | Loading states | 1.5 |
| 1.12 | Error states | 1.5 |
| 1.13 | Success state (post-bid) | 1.8 |
| 1.14 | Responsive mobile design | 1.1 |
| 1.15 | UI polish (animations, transitions) | 1.14 |

### Phase 2 — Database
| Task | Description | Dependencies |
|------|-------------|--------------|
| 2.1 | Categories schema + migration | 0.5 |
| 2.2 | Bids schema + migration | 2.1 |
| 2.3 | Database indexes | 2.2 |
| 2.4 | Constraints (unique, check) | 2.2 |
| 2.5 | RLS / security policies | 2.2 |
| 2.6 | Seed categories | 2.5 |
| 2.7 | Category queries (list, get) | 2.6 |
| 2.8 | Highest bid query | 2.7 |
| 2.9 | Leaderboard query | 2.8 |
| 2.10 | Recent bids query | 2.7 |

### Phase 3 — Bid Engine
| Task | Description | Dependencies |
|------|-------------|--------------|
| 3.1 | Calculate minimum bid (no existing bids) | 2.8 |
| 3.2 | Calculate minimum bid (existing bids) | 3.1 |
| 3.3 | Validate bid amount server-side | 3.2 |
| 3.4 | Validate category server-side | 3.3 |
| 3.5 | Create pending bid record | 3.4 |
| 3.6 | Handle concurrent bids (DB locking) | 3.5 |
| 3.7 | Prevent duplicate transactions | 3.6 |
| 3.8 | Bid engine unit tests | 3.7 |

### Phase 4 — Stripe Payment
| Task | Description | Dependencies |
|------|-------------|--------------|
| 4.1 | Create Stripe Checkout session | 3.5, 0.6 |
| 4.2 | Attach category/bid metadata | 4.1 |
| 4.3 | Success page | 4.2 |
| 4.4 | Cancel page | 4.2 |
| 4.5 | Stripe webhook endpoint | 0.6 |
| 4.6 | Verify webhook signature | 4.5 |
| 4.7 | Verify payment status | 4.6 |
| 4.8 | Convert pending bid to paid | 4.7 |
| 4.9 | Idempotent webhook handling | 4.8 |
| 4.10 | Payment failure handling | 4.8 |
| 4.11 | Refund handling | 4.10 |
| 4.12 | Stripe integration tests | 4.11 |

### Phase 5 — Realtime Leaderboard
| Task | Description | Dependencies |
|------|-------------|--------------|
| 5.1 | Supabase realtime subscription | 2.9, 4.8 |
| 5.2 | Update highest bid display | 5.1 |
| 5.3 | Update leaderboard rankings | 5.2 |
| 5.4 | Recent bid updates | 5.1 |
| 5.5 | Rank change animation | 5.3 |
| 5.6 | New #1 state celebration | 5.5 |
| 5.7 | Connection/reconnection handling | 5.1 |

### Phase 6 — Outbid Notifications
| Task | Description | Dependencies |
|------|-------------|--------------|
| 6.1 | Detect previous highest bidder | 4.8 |
| 6.2 | Email provider integration (Resend) | 0.7 |
| 6.3 | Outbid email template | 6.2 |
| 6.4 | Send outbid notification | 6.3 |
| 6.5 | Bid-again link in email | 6.4 |
| 6.6 | Unsubscribe handling | 6.5 |
| 6.7 | Email failure handling | 6.6 |

### Phase 7 — Viral Sharing
| Task | Description | Dependencies |
|------|-------------|--------------|
| 7.1 | Bid success page | 4.3 |
| 7.2 | Share on X (Twitter) | 7.1 |
| 7.3 | Copy share link | 7.1 |
| 7.4 | Public category URL | 2.7 |
| 7.5 | Open Graph metadata | 7.4 |
| 7.6 | Dynamic OG image | 7.5 |
| 7.7 | Share tracking | 7.2 |

### Phase 8 — Admin
| Task | Description | Dependencies |
|------|-------------|--------------|
| 8.1 | Admin authentication | 0.1 |
| 8.2 | Admin dashboard | 8.1 |
| 8.3 | Category management | 8.2 |
| 8.4 | Bid management | 8.2 |
| 8.5 | Payment management | 8.4 |
| 8.6 | Refund action | 8.5 |
| 8.7 | Fraud/banned email management | 8.5 |
| 8.8 | Audit logs | 8.1 |

### Phase 9 — Security and Reliability
| Task | Description | Dependencies |
|------|-------------|--------------|
| 9.1 | Input validation (all endpoints) | 3.3, 4.7 |
| 9.2 | Rate limiting | 3.5 |
| 9.3 | CAPTCHA if needed | 9.2 |
| 9.4 | Stripe security review | 4.12 |
| 9.5 | Webhook security review | 4.9 |
| 9.6 | Database security review | 2.5 |
| 9.7 | RLS review | 2.5 |
| 9.8 | Concurrency testing | 3.6 |
| 9.9 | Duplicate payment testing | 4.9 |
| 9.10 | Fraud scenarios | 8.7 |
| 9.11 | Error handling review | 9.1 |

### Phase 10 — Production Launch
| Task | Description | Dependencies |
|------|-------------|--------------|
| 10.1 | Production environment | 9.11 |
| 10.2 | Production database | 10.1 |
| 10.3 | Stripe live mode | 10.1 |
| 10.4 | Custom domain | 10.1 |
| 10.5 | SEO optimization | 7.5 |
| 10.6 | Analytics setup | 10.1 |
| 10.7 | Error monitoring | 10.1 |
| 10.8 | Performance review | 10.7 |
| 10.9 | Mobile testing | 1.14 |
| 10.10 | Final QA | 10.9 |
| 10.11 | Launch checklist | 10.10 |

## Definition of Done (Per Task)

- [ ] Implementation complete per task requirements
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Linting passes (`npm run lint`)
- [ ] Tests pass (when applicable)
- [ ] Task documentation updated (`docs/<TASK_ID>.txt`)
- [ ] PROJECT_PROGRESS.md updated
- [ ] PROJECT_RESULT.md updated
- [ ] Git commit with proper message format

## Testing Strategy

- **Unit tests**: Bid engine calculations, validation logic
- **Integration tests**: Stripe webhook handling, database operations
- **E2E tests**: Critical user flows (bid → pay → leaderboard update)
- **Concurrency tests**: Simultaneous bid attempts
- **Security tests**: Webhook signature verification, input validation

## Deployment Strategy

1. **Development**: Local + Vercel preview deployments
2. **Staging**: Vercel preview with staging Supabase/Stripe
3. **Production**: Vercel production with live Supabase/Stripe
4. **Database migrations**: Run via Supabase CLI or migration scripts
5. **Environment variables**: Managed in Vercel dashboard

---

*This plan is the source of truth. Do not mark tasks as completed here unless explicitly tracking status.*