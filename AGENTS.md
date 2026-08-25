## AGENTS.md Immutability

AGENTS.md is immutable during normal development.

The coding agent MUST NOT modify AGENTS.md.

If AGENTS.md needs to be changed, STOP and ask the user for explicit permission.

Never modify AGENTS.md as part of a normal implementation task.

# Repository Safety — CRITICAL

These rules have the highest priority.

## Protected Files

The following files are PROJECT CONTROL FILES.

They MUST NEVER be deleted, renamed, moved, replaced, truncated, or overwritten unless the user explicitly requests it:

```text
AGENTS.md
README.md
docs/PROJECT_PLAN.md
docs/PROJECT_PROGRESS.md
docs/PROJECT_RESULT.md
```

These files contain the project's persistent instructions, development plan, progress, and implementation history.

A task must NEVER modify these files destructively.

Updates to these files are allowed ONLY when required by the documented workflow.

---

## Protected Documentation Directory

The following directory is protected:

```text
docs/
```

Never delete or recreate the entire `docs/` directory.

Never bulk-delete task documentation.

Never rename task files unless explicitly instructed.

Existing task files must be preserved.

---

## Task Scope Rule

When implementing a task such as:

```text
0.1
```

you may modify ONLY:

1. Files explicitly required by that task.
2. Files needed to integrate the implementation.
3. The required documentation files:

   - `docs/0.1.txt`
   - `docs/PROJECT_PROGRESS.md`
   - `docs/PROJECT_RESULT.md`

Do NOT modify future task files.

Do NOT modify unrelated application files.

Do NOT rewrite project configuration unless the current task requires it.

---

## Existing Repository Rule

Before creating, deleting, moving, or replacing ANY file:

1. Inspect the existing repository.
2. Determine whether the file already exists.
3. Preserve existing project files unless the current task explicitly requires changing them.
4. Never assume the repository is empty.
5. Never assume generated scaffolding should overwrite existing files.

If an existing file conflicts with generated project scaffolding:

STOP and inspect the conflict.

Do NOT automatically delete or overwrite the existing file.

---

## Destructive Operations

The following operations require explicit user approval:

```text
rm -rf
rm -r
git clean
git reset --hard
git checkout -- <file>
bulk file deletion
bulk file replacement
deleting AGENTS.md
deleting README.md
deleting docs/
deleting PROJECT_PLAN.md
deleting PROJECT_PROGRESS.md
deleting PROJECT_RESULT.md
```

Do not perform destructive operations simply to make a framework initializer work.

---

## Framework Initialization Safety

If initializing a framework such as Next.js in an existing repository:

1. Inspect the repository first.
2. Check whether `package.json` already exists.
3. Check whether `app/`, `src/`, `public/`, `docs/`, and configuration files already exist.
4. Preserve project documentation and control files.
5. Do not run a framework initializer in a way that overwrites existing project files.
6. If initialization would overwrite protected files, stop and use a non-destructive approach.

The repository documentation is part of the application infrastructure and must be preserved.

---

## Before Every Commit

Run:

```bash
git status --short
```

Review EVERY changed file.

Before committing, verify:

```text
AGENTS.md                  → MUST EXIST
README.md                  → MUST EXIST
docs/PROJECT_PLAN.md       → MUST EXIST
docs/PROJECT_PROGRESS.md   → MUST EXIST
docs/PROJECT_RESULT.md     → MUST EXIST
```

If any protected file is missing:

STOP.

Do NOT commit.

Do NOT push.

Restore/investigate the missing file before continuing.

---

## Before Every Push

Run:

```bash
git status --short
git diff --stat
git diff --name-status
```

Confirm:

1. Only expected files changed.
2. No protected file was deleted.
3. No unrelated files were modified.
4. Tests pass.
5. TypeScript checks pass.
6. Lint passes when configured.
7. Build passes when applicable.

Only then commit and push.

---

# AGENTS.md — Topbid.lol Agent Instructions

This file provides instructions for AI agents working on the Topbid.lol project.

## Project Overview

**Topbid.lol** is a simple public bidding/leaderboard website where users bid on categories and compete for the top spot.

**Core bidding flow:**

1. Users choose a category
2. Users click BID
3. System checks current highest paid bid for that category
4. If no bids exist, use category's starting bid; otherwise calculate minimum valid bid = highest_bid + increment
5. User pays through Stripe Checkout
6. Only after Stripe confirms payment via verified webhook does the bid become valid
7. New bid becomes highest bid for that category
8. Leaderboard updates in real-time
9. Previous highest bidder may receive outbid notification

**Technology Stack:**

- **Framework**: Next.js 16+ (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v4
- **Database**: Supabase / PostgreSQL
- **Payments**: Stripe (Checkout + Webhooks)
- **Deployment**: Vercel

## Architecture

- **Next.js App Router** with React Server Components and Server Actions
- **Supabase/PostgreSQL** for data persistence (categories, bids)
- **Stripe Checkout** for payment processing; **Stripe Webhooks** for payment confirmation
- **Vercel** for hosting and deployment
- **Server/client responsibilities**:
  - Server: Bid calculations, payment validation, database writes, webhook handling
  - Client: UI rendering, Stripe Checkout redirect, real-time subscriptions

## Security Rules

**Non-negotiable security principles:**

- **Never trust client-provided bid amounts** — All bid calculations must happen server-side
- **Never expose secret environment variables to the client** — No NEXT_PUBLIC_ prefix for server-only secrets
- **Stripe webhook signatures must be verified** on every request
- **Stripe webhook handling must be idempotent** — Use event IDs to prevent duplicate processing
- **Supabase service role key is server-only** — Never expose to client
- **Never commit .env.local or secrets** — .env.local is in .gitignore
- **Validate all API input** — Use Zod or similar for request validation
- **Follow RLS policies** — Database access controlled by Row Level Security
- **Do not bypass security controls for convenience**

## Environment Variables

### Server-only (never expose to client, no NEXT_PUBLIC_ prefix):

- `STRIPE_SECRET_KEY` — Stripe secret key for server-side operations
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role for admin operations
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret

### Client-safe (must use NEXT_PUBLIC_ prefix):

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anonymous key for client
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — Stripe publishable key
- `NEXT_PUBLIC_APP_URL` — Application URL (e.g., https://topbid.lol)

### Environment variable management:

- `.env.local` is for local development only — **never committed**
- Production environment variables belong in Vercel Project Settings
- Stripe production/live secrets must not be used casually during development

## Development Workflow

When implementing any task:

1. **Read PROJECT_PLAN.md** — Understand the overall roadmap
2. **Identify the exact task being worked on** — Read the specific task file
3. **Inspect existing implementation** — Understand current code before modifying
4. **Make the smallest necessary changes** — Focus only on the assigned task
5. **Run relevant tests/checks** — Verify your changes don't break existing functionality
6. **Update task documentation** — Document what was actually implemented
7. **Update PROJECT_PROGRESS.md** — Mark task as completed, note next recommended task
8. **Update PROJECT_RESULT.md** — Add cumulative implementation record
9. **Commit using required format** — `feat(<task_id>): <description>` or `fix(<task_id>): <description>`
10. **Push to origin/main** when explicitly requested or appropriate

## Task Scope Rules

Agents must:

- Work only on the assigned task
- Not silently implement future tasks
- Not mark unrelated tasks as completed
- Not change PROJECT_PLAN.md task status unless explicitly requested
- Preserve existing functionality
- Avoid unnecessary dependencies
- Avoid unnecessary architectural changes

## Quality Checks

Run these checks when applicable:

```bash
npm run typecheck    # TypeScript compiler check
npm run lint         # ESLint with Prettier rules
npm run format:check # Prettier format verification
npm run build        # Production build verification
npm run test         # Tests (when available)
```

Fix any issues caused by your changes before committing.

## Documentation Workflow

Every completed task must update these three files:

- `docs/<TASK_ID>.txt` — Task-specific documentation with actual results
- `docs/PROJECT_PROGRESS.md` — Current project state
- `docs/PROJECT_RESULT.md` — Cumulative implementation record

Each task document must clearly state:

- Task ID and title
- Objective
- Implementation details
- Files changed
- Validation/tests run
- Final status
- Commit information when available

## Git Workflow

**Commit convention:**

```
<type>(<task-id>): <description>
```

**Examples:**

- `feat(0.9): configure Vercel deployment`
- `feat(0.10): create agent documentation workflow`
- `fix(3.6): handle concurrent bids`

**Do not create vague commits:**

- `update`
- `changes`
- `fixes`
- `work`
- `stuff`

**Branch strategy:**

- Create feature branches for each task (optional for solo development)
- Commit after each completed task
- Push to remote when task is complete and verified

## Critical Rules

1. **Documentation is the source of truth** — Never rely on conversation history. Always read the docs first.
2. **One task at a time** — Implement only the requested task. Do not silently implement future tasks.
3. **Incremental development** — Follow the PHASE → FEATURE → IMPLEMENT → TEST → VERIFY → DOCUMENT → COMMIT hierarchy.
4. **Small commits** — Use meaningful commit messages: `feat(<task_id>): <description>`

## Required Reading Before Any Task

Before implementing any task, you MUST read:

- `AGENTS.md` (this file)
- `docs/PROJECT_PLAN.md`
- `docs/PROJECT_PROGRESS.md`
- `docs/PROJECT_RESULT.md`
- `docs/<TASK_ID>.txt` (the specific task file)

## Task Execution Workflow

When asked to implement a task (e.g., "Implement task 3.1"):

1. Read all required documentation files
2. Inspect existing code before modifying
3. Implement ONLY the specified task
4. Run relevant tests
5. Run TypeScript checks (`npm run typecheck` or equivalent)
6. Run linting (`npm run lint` or equivalent)
7. Fix any issues caused by your implementation
8. Update task documentation:
   - `docs/<TASK_ID>.txt` (with actual results)
   - `docs/PROJECT_PROGRESS.md`
   - `docs/PROJECT_RESULT.md`
9. Report: files changed, tests run, test results, known issues, completion status

## Business Rules (Non-Negotiable)

- **Bid amount**: Client must NEVER determine authoritative bid amount. Server calculates and validates.
- **Payment**: Bid becomes valid ONLY after verified Stripe webhook confirmation.
- **Leaderboard**: Only paid/valid bids affect the leaderboard.
- **Starting bid**: No valid bids → `minimum = category.starting_bid`
- **Existing bid**: Has valid highest bid → `minimum = highest_bid + increment`
- **Concurrency**: Two simultaneous bids must not corrupt leaderboard (use DB transactions/locking).
- **No accounts**: MVP does not require user registration/passwords.

## Code Quality Standards

- Prefer: simple architecture, small functions, strict TypeScript, server-side validation, clear naming, reusable components, testable business logic, secure payment handling, minimal dependencies
- Avoid: unnecessary abstractions, premature optimization, unnecessary libraries, duplicated business logic, client-side trust, giant components, giant API routes, mixing payment logic into UI components

## Environment Setup

```bash
# Required environment variables (see .env.example)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
```

## Useful Commands

```bash
npm run dev          # Start development server
npm run build        # Production build
npm run lint         # Run linter
npm run typecheck    # Run TypeScript compiler check
npm run test         # Run tests (when available)
```

## Git Workflow

- Create feature branches for each task
- Commit after each completed task
- Commit format: `feat(<task_id>): <description>` or `fix(<task_id>): <description>`
- Push to remote when task is complete and verified

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
