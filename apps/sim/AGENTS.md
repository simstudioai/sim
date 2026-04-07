# Sim App Scope

These rules apply to files under `apps/sim/` in addition to the repository root [AGENTS.md](/AGENTS.md).

## Architecture

### Core Principles
1. **Single Responsibility**: Each component, hook, store has one clear purpose
2. **Composition Over Complexity**: Break down complex logic into smaller pieces
3. **Type Safety First**: TypeScript interfaces for all props, state, return types
4. **Predictable State**: Zustand for global state, useState for UI-only concerns

### Root-Level Structure

```
apps/sim/
├── app/                 # Next.js app router (pages, API routes)
├── blocks/              # Block definitions and registry
├── components/          # Shared UI (emcn/, ui/)
├── executor/            # Workflow execution engine
├── hooks/               # Shared hooks (queries/, selectors/)
├── lib/                 # App-wide utilities
├── providers/           # LLM provider integrations
├── stores/              # Zustand stores
├── tools/               # Tool definitions
└── triggers/            # Trigger definitions
```

### Feature Organization

Features live under `app/workspace/[workspaceId]/`:

```
feature/
├── components/          # Feature components
├── hooks/               # Feature-scoped hooks
├── utils/               # Feature-scoped utilities (2+ consumers)
├── feature.tsx          # Main component
└── page.tsx             # Next.js page entry
```

### Naming Conventions
- **Components**: PascalCase (`WorkflowList`)
- **Hooks**: `use` prefix (`useWorkflowOperations`)
- **Files**: kebab-case (`workflow-list.tsx`)
- **Stores**: `stores/feature/store.ts`
- **Constants**: SCREAMING_SNAKE_CASE
- **Interfaces**: PascalCase with suffix (`WorkflowListProps`)

## Imports And Types

- Always use absolute imports from `@/...`; do not add relative imports.
- Use barrel exports only when a folder has 3+ exports; do not re-export through non-barrel files.
- Use `import type` for type-only imports.
- Do not use `any`; prefer precise types or `unknown` with guards.

## Components And Styling

- Use `'use client'` only when hooks or browser-only APIs are required.
- Define a props interface for every component.
- Extract constants with `as const` where appropriate.
- Use Tailwind classes and `cn()` for conditional classes; avoid inline styles unless CSS variables are the intended mechanism.
- Keep styling local to the component; do not modify global styles for feature work.

## Testing

- Use Vitest.
- Prefer `@vitest-environment node` unless DOM APIs are required.
- Use `vi.hoisted()` + `vi.mock()` + static imports; do not use `vi.resetModules()` + `vi.doMock()` + dynamic imports except for true module-scope singletons.
- Do not use `vi.importActual()`.
- Prefer mocks and factories from `@sim/testing`.

## Utils Rules

- **Never create `utils.ts` for single consumer** - inline it
- **Create `utils.ts` when** 2+ files need the same helper
- **Check existing sources** before duplicating (`lib/` has many utilities)
- **Location**: `lib/` (app-wide) → `feature/utils/` (feature-scoped) → inline (single-use)
