---
name: emcn-design-review
description: Review UI code for alignment with the emcn design system — components, tokens, patterns, and conventions
argument-hint: "[scope] [fix=true|false]"
---

# EMCN Design Review

Arguments:
- scope: what to review (default: your current changes). Examples: "diff to main", "PR #123", "src/components/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

## Context

This codebase uses **emcn**, a custom component library built on Radix UI primitives with CVA variants and CSS variable design tokens. All UI must use emcn components and tokens.

## Deterministic conformance and fixes

For committed product UI changes, run `bun run check:design --base <actual-target-branch> --head HEAD`. This checks central derivation, component ownership and system changes; it does not judge whether an approved red variant or monospace font is a good product choice. The style review advice below may inform suggestions, but must not be presented as additional deterministic linter rules.

With fixes enabled, correct straightforward local violations using the cited central token, recipe or component prop. For a small gray adjustment, choose the approved token that fits its role (body, muted, icon or surface); do not hardcode the nearest hex. Ask the engineer when a correction has broad impact or ambiguous intent, especially before changing shared definitions or adding variants. An intentional change or justified artwork exception can proceed with an explanation in the PR; retain the warning. New shared standards should involve the designer. Do not enlarge this task into a whole-codebase cleanup or invent a central token just to pass.

Untouched debt stays quiet. Bringing noncompliant styling into a new file or component is an opportunity to fix it, even when its value is unchanged. Product artwork should use the registered central libraries; central asset changes notify. Landing pages, user media and sanctioned provider branding are separate scope. Unknown HTML illustrations may still receive normal styling warnings. Unresolved inputs are not proof of conformance. Only committed blobs are checked, and exit 2 means an operational failure; CI findings currently warn without blocking. See `scripts/design-conformance/README.md` for exact coverage.

## Steps

1. Read the emcn public barrel at `packages/emcn/src/index.ts` (re-exports components, Calendar, Table*, and icons) to know what's available; for the full icon set read `packages/emcn/src/icons/index.ts`
2. Read `apps/sim/app/_styles/globals.css` for CSS variable tokens
3. Analyze the specified scope against every rule below
4. If fix=true, apply the fixes. If fix=false, propose the fixes without applying.

---

## Imports

- Components, `cn`, and tokens from the `@sim/emcn` barrel, never component subpaths
- Icons from `@sim/emcn/icons`

## Design Tokens

Use CSS variable pattern (`text-[var(--text-primary)]`), never Tailwind semantics (`text-muted-foreground`) or hardcoded colors (`text-gray-500`, `#333`).

**Text**: `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-muted`, `--text-body` (canonical value text), `--text-icon`, `--text-placeholder`, `--text-subtle`, `--text-inverse`, `--text-error`
**Surfaces**: `--bg`, `--surface-1` through `--surface-7`, `--surface-hover`, `--surface-active`
**Borders**: `--border` (`--border-1`/`--border-muted` are legacy aliases resolving to it — flag new uses)
**Brand/accent**: `--brand-secondary`, `--brand-accent`
**Z-Index**: `--z-dropdown` (100), `--z-toast` (150), `--z-modal` (200), `--z-popover` (300), `--z-tooltip` (400), `--z-takeover` (500), `--z-shell-gate` (600)
**Shadows**: `shadow-subtle`, `shadow-medium`, `shadow-overlay`, `shadow-card`
**Badges**: `--badge-*` semantic families (success/error/gray/blue/purple/orange/amber/teal/cyan/pink, each with `-bg`/`-text`)

## Buttons

Intent-to-variant mapping (read the actual `buttonVariants` in `packages/emcn/src/components/button/button.tsx` for the full variant set — it exposes more than listed here):

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

`toast.success()`, `toast.error()`, `toast()` from `@sim/emcn`. Never custom notification UI.

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
