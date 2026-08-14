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

## Protected Application Operations

Every real operation on protected or persisted data crosses one authorized application boundary:

1. The surface authenticates its credential or trusted context and constructs a `Principal`.
2. A fixed, code-defined semantic operation declares minimum role, workspace-key policy, allowed principal kinds, and delegated services.
3. The application use case loads canonical context, checks asserted scope, authorizes current access, executes the manager/repository, projects semantic audit, and runs shared domain effects.
4. The surface presents its own internal, v2, Copilot, or tool result.

Routes and tools must not query protected data, authorize resources, implement business transactions, or record semantic audit. Application modules must not import `app/api/**`, `next/server`, route contracts/presenters, or Copilot handlers. Copilot must call the same domain use case through `createCopilotApplicationAdapter`; do not create a second Copilot business implementation. Atomic compound mutations need one top-level semantic application operation rather than sequential surface calls.

Ordinary internal and v2 routes use the shared JSON/binary route builders. Those builders already apply `withRouteHandler`; do not double-wrap them. Use raw `withRouteHandler` only for explicit protocol, streaming, large-body, multipart, or lifecycle exceptions, while keeping protected business work inside application use cases.

Use the `migrate-application-operation` skill before creating or migrating a protected endpoint, tool command, or resource method.

## The `'use client'` server boundary

Every export of a `'use client'` module becomes a *client reference* on the server — server-evaluated code (RSC pages/layouts, `prefetch.ts`, route handlers, block definitions, triggers) can only *render* it as a component or pass it as a prop, never *call* it (doing so throws at runtime, e.g. `tableKeys.list is not a function`; `next build` does not catch it). Keep server-importable query primitives (key factories, fetchers, mappers, constants) in non-`'use client'` modules — see `.claude/rules/sim-queries.md`. Enforced by `scripts/check-client-boundary-imports.ts`.

## The app/worker runtime boundary

Server code runs in two runtimes with **different environments**. The app container loads the
full env from `SIM_ENV_SECRET_ID` (Secrets Manager). Trigger.dev workers — which execute
workflows, so every block handler and every tool call — get their env from the Trigger.dev
dashboard, and `trigger.config.ts` syncs only `DB_APP_NAME`. The repo cannot see what the
dashboard holds.

So before replacing a worker's HTTP call to our own API with an in-process call, ask what env
that work reads *on the app side*. Anything gated by a `require*Capability` helper is the sharp
case: those **throw** when the variable is absent (`requireOAuthClientCapability` →
`EnvCapabilityConfigurationError`), and the throw may be caught and reported as something
unrelated. OAuth token refresh is the known example — moving it into the worker turns every
expired credential into `Failed to refresh access token`, while a still-valid token hides the
bug entirely, so it surfaces hours later and only for whoever's token lapsed first.

An in-process conversion is safe when the same work already runs in that runtime (the agent
block has always called `executeProviderRequest` in-process, so router and evaluator joining it
is proven), or when the caller and the callee are both the app (a route calling a lib module, an
RSC prefetch reading the data layer). It is not safe on reasoning alone.

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
