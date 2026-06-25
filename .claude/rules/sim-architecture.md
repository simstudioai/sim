---
paths:
  - "apps/sim/**"
---

# Sim App Architecture

## Core Principles
1. **Single Responsibility**: Each component, hook, store has one clear purpose
2. **Composition Over Complexity**: Break down complex logic into smaller pieces
3. **Type Safety First**: TypeScript interfaces for all props, state, return types
4. **Predictable State**: Zustand for global state, useState for UI-only concerns

## Root-Level Structure

```
apps/
├── sim/                 # this app (Next.js: UI + API routes + workflow editor)
│   ├── app/             # Next.js app router (pages, API routes)
│   ├── blocks/          # Block definitions and registry
│   ├── components/      # Shared UI (emcn/, ui/)
│   ├── executor/        # Workflow execution engine
│   ├── hooks/           # Shared hooks (queries/, selectors/)
│   ├── lib/             # App-wide utilities
│   ├── providers/       # LLM provider integrations
│   ├── stores/          # Zustand stores
│   ├── tools/           # Tool definitions
│   └── triggers/        # Trigger definitions
└── realtime/            # Bun Socket.IO server (collaborative canvas)

packages/                # @sim/* — audit, auth, db, logger, realtime-protocol,
                         # security, tsconfig, utils, platform-authz,
                         # workflow-persistence, workflow-types
```

## Package Boundaries

- `apps/* → packages/*` only. Packages never import from `apps/*`.
- `apps/realtime` avoids Next.js, React, the block/tool registry, provider SDKs, and the executor; never add `@/lib/webhooks/providers/*`, `@/executor/*`, `@/blocks/*`, or `@/tools/*` imports to any package it consumes. CI enforces this via `scripts/check-monorepo-boundaries.ts` and `scripts/check-realtime-prune-graph.ts`.

## The `'use client'` server boundary

Every export of a `'use client'` module becomes a *client reference* on the server — server-evaluated code (RSC pages/layouts, `prefetch.ts`, route handlers, block definitions, triggers) can only *render* it as a component or pass it as a prop, never *call* it (doing so throws at runtime, e.g. `tableKeys.list is not a function`; `next build` does not catch it). Keep server-importable query primitives (key factories, fetchers, mappers, constants) in non-`'use client'` modules — see `.claude/rules/sim-queries.md`. Enforced by `scripts/check-client-boundary-imports.ts`.

## Feature Organization

Features live under `app/workspace/[workspaceId]/`:

```
feature/
├── components/          # Feature components
├── hooks/               # Feature-scoped hooks
├── utils/               # Feature-scoped utilities (2+ consumers)
├── feature.tsx          # Main component
└── page.tsx             # Next.js page entry
```

## Naming Conventions
- **Components**: PascalCase (`WorkflowList`)
- **Hooks**: `use` prefix (`useWorkflowOperations`)
- **Files**: kebab-case (`workflow-list.tsx`)
- **Stores**: `stores/feature/store.ts`
- **Constants**: SCREAMING_SNAKE_CASE
- **Interfaces**: PascalCase with suffix (`WorkflowListProps`)

## Utils Rules

- **Never create `utils.ts` for single consumer** - inline it
- **Create `utils.ts` when** 2+ files need the same helper
- **Check existing sources** before duplicating (`lib/` has many utilities)
- **Location**: `lib/` (app-wide) → `feature/utils/` (feature-scoped) → inline (single-use)
