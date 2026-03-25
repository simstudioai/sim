# Sim App Scope

These rules apply to files under `apps/sim/` in addition to the repository root [AGENTS.md](/AGENTS.md).

## Architecture

- Follow the app structure already established under `app/`, `blocks/`, `components/`, `executor/`, `hooks/`, `lib/`, `providers/`, `stores/`, `tools/`, and `triggers/`.
- Keep single responsibility for components, hooks, and stores.
- Prefer composition over large mixed-responsibility modules.
- Use `lib/` for app-wide helpers, feature-local `utils/` only when 2+ files share the helper, and inline single-use helpers.

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
