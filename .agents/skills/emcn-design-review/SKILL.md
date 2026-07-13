---
name: emcn-design-review
description: Review UI code for alignment with the emcn design system — components, tokens, patterns, and conventions
argument-hint: [scope] [fix=true|false]
---

# EMCN Design Review

Arguments:
- scope: what to review (default: your current changes). Examples: "diff to main", "PR #123", "src/components/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

## Context

This codebase uses **emcn**, a custom component library built on Radix UI primitives with CVA variants and CSS variable design tokens. All UI must use emcn components and tokens.

## Steps

1. Read the emcn public barrel at `apps/sim/components/emcn/index.ts` (re-exports components, Calendar, Table*, and icons) to know what's available; for the full icon set read `apps/sim/components/emcn/icons/index.ts`
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

**Text**: `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-muted`, `--text-body` (canonical value text), `--text-icon`, `--text-placeholder`, `--text-subtle`, `--text-inverse`, `--text-error`
**Surfaces**: `--bg`, `--surface-1` through `--surface-7`, `--surface-hover`, `--surface-active`
**Borders**: `--border`, `--border-1`, `--border-muted`
**Brand/accent**: `--brand-secondary`, `--brand-accent`
**Z-Index**: `--z-dropdown` (100), `--z-modal` (200), `--z-popover` (300), `--z-tooltip` (400), `--z-toast` (500)
**Shadows**: `shadow-subtle`, `shadow-medium`, `shadow-overlay`, `shadow-card`
**Badges**: `--badge-*` semantic families (success/error/gray/blue/purple/orange/amber/teal/cyan/pink, each with `-bg`/`-text`)

## Buttons

Intent-to-variant mapping (read the actual `buttonVariants` in `apps/sim/components/emcn/components/button/button.tsx` for the full variant set — it exposes more than listed here):

| Action | Variant |
|--------|---------|
| Toolbar, icon-only | `ghost` |
| Create, save, submit | `primary` |
| Cancel, close | `default` |
| Delete, remove | `destructive` |
| Selected state | `active` |
| Toggle | `outline` |

## Delete/Remove Confirmations

`ChipModal` `size='sm'`, title "Delete/Remove {ItemType}", destructive confirm button, plain Cancel (follow the chip footer layout in `.claude/rules/emcn-components.md`). Use `text-[var(--text-error)]` for irreversible warnings.

## Toast

`toast.success()`, `toast.error()`, `toast()` from `@/components/emcn`. Never custom notification UI.

## Badges

`red`=error/failed, `gray-secondary`=metadata/roles, `type`=type annotations, `green`=success/active, `gray`=neutral, `amber`=processing, `orange`=paused, `blue`=info. Use `dot` prop for status indicators.

## Icons

Default: `size-[14px]`. Color: `text-[var(--text-icon)]`. Scale: 14px > 16px > 12px > 20px. Use the `size-*` shorthand — flag `h-[Npx] w-[Npx]` and `h-N w-N` pairs as refactor targets.

## Anti-patterns to flag

- Raw `<button>`/`<input>`, or legacy `Input`/`Textarea`/`Modal`, instead of the canonical chip components (`ChipInput`/`ChipTextarea`/`ChipModal`)
- Hand-rolled field rows inside a `ChipModalBody` instead of `ChipModalField`
- Hardcoded colors (`text-gray-*`, `#hex`, `rgb()`)
- Tailwind semantics (`text-muted-foreground`) instead of CSS variables
- Template literal className instead of `cn()`
- Inline styles for colors/static values (dynamic values OK)
- Importing from emcn subpaths instead of barrel
- Arbitrary z-index instead of tokens
- Wrong button variant for action type
