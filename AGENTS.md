# AGENTS.md — Topbid.lol Agent Instructions

This file provides instructions for AI agents working on the Topbid.lol project.

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
5. Run linting (`npm run lint` or equivalent)
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