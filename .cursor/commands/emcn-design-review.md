# EMCN Design Review

Arguments:
- scope: what to review (default: your current changes). Examples: "diff to main", "PR #123", "src/components/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

## Context

This codebase uses **emcn**, a custom component library built on Radix UI primitives with CVA variants and CSS variable design tokens. All UI must use emcn components and tokens.

## Steps

1. Read the emcn barrel export at `apps/sim/components/emcn/components/index.ts` to know what's available
2. Read `apps/sim/app/_styles/globals.css` for CSS variable tokens
3. Analyze the specified scope against every rule below
4. If fix=true, apply the fixes. If fix=false, propose the fixes without applying.

---

## Imports

- Import from `@/components/emcn` barrel, never subpaths
- Icons from `@/components/emcn/icons` or `lucide-react`
- Use `cn` from `@/lib/core/utils/cn` for conditional classes

## Design Tokens

Use CSS variable pattern (`text-[var(--text-primary)]`), never Tailwind semantics (`text-muted-foreground`) or hardcoded colors (`text-gray-500`, `#333`).

**Text**: `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-muted`, `--text-icon`, `--text-inverse`, `--text-error`
**Surfaces**: `--bg`, `--surface-2` through `--surface-7`, `--surface-hover`, `--surface-active`
**Borders**: `--border`, `--border-1`, `--border-muted`
**Z-Index**: `--z-dropdown` (100), `--z-modal` (200), `--z-popover` (300), `--z-tooltip` (400), `--z-toast` (500)
**Shadows**: `shadow-subtle`, `shadow-medium`, `shadow-overlay`, `shadow-card`

## Buttons

| Action | Variant |
|--------|---------|
| Toolbar, icon-only | `ghost` (most common, 28%) |
| Create, save, submit | `primary` (24%) |
| Cancel, close | `default` |
| Delete, remove | `destructive` |
| Selected state | `active` |
| Toggle | `outline` |

## Delete/Remove Confirmations

Modal `size="sm"`, title "Delete/Remove {ItemType}", `variant="destructive"` action button, `variant="default"` cancel. Cancel left, action right (100% compliance). Use `text-[var(--text-error)]` for irreversible warnings.

## Toast

`toast.success()`, `toast.error()`, `toast()` from `@/components/emcn`. Never custom notification UI.

## Badges

`red`=error/failed, `gray-secondary`=metadata/roles, `type`=type annotations, `green`=success/active, `gray`=neutral, `amber`=processing, `orange`=paused, `blue`=info. Use `dot` prop for status indicators.

## Icons

Default: `h-[14px] w-[14px]` (400+ uses). Color: `text-[var(--text-icon)]`. Scale: 14px > 16px > 12px > 20px.

## Anti-patterns to flag

- Raw `<button>`/`<input>` instead of emcn components
- Hardcoded colors (`text-gray-*`, `#hex`, `rgb()`)
- Tailwind semantics (`text-muted-foreground`) instead of CSS variables
- Template literal className instead of `cn()`
- Inline styles for colors/static values (dynamic values OK)
- Importing from emcn subpaths instead of barrel
- Arbitrary z-index instead of tokens
- Wrong button variant for action type
