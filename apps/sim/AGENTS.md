# Sim App Scope

Applies to `apps/sim/**` on top of the root [AGENTS.md](/AGENTS.md), which holds the repo-wide rules. Before editing in an area, read its rule file under `.claude/rules/`:

- API routes, contracts, route builders, boundary annotations, `requestJson`: `sim-api-contracts.md`
- React Query hooks and server prefetch: `sim-queries.md`
- `'use client'` server boundary, app/worker runtime env, feature folder layout: `sim-architecture.md`
- Components, hooks, stores, imports: `sim-components.md`, `sim-hooks.md`, `sim-stores.md`, `sim-imports.md`
- Styling and emcn chrome, UI copy, settings pages: `sim-styling.md`, `sim-ui-copy.md`, `sim-settings-pages.md`
- URL state, list and menu order, caching: `sim-url-state.md`, `sim-list-ordering.md`, `sim-caching.md`
- Tools, blocks, triggers: `sim-integrations.md`; isolated-vm sandbox worker: `sim-sandbox.md`
- Tests: `sim-testing.md` and the `test-audit` skill
- Landing pages: `app/(landing)/CLAUDE.md`, `landing-seo-geo.md`, `constitution.md` (product language)

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
