# EMCN Design Review

Arguments:
- scope: what to review (default: your current changes). Examples: "diff to main", "PR #123", "src/components/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

## Context

This codebase uses **emcn**, a custom component library built on Radix UI primitives with CVA (class-variance-authority) variants and CSS variable design tokens. All UI must use emcn components and tokens — never raw HTML elements or hardcoded colors.

## Steps

1. Read the emcn barrel export at `apps/sim/components/emcn/components/index.ts` to know what's available
2. Read `apps/sim/app/_styles/globals.css` for the full set of CSS variable tokens
3. Analyze the specified scope against every rule below
4. If fix=true, apply the fixes. If fix=false, propose the fixes without applying.

---

## Imports

- Import components from `@/components/emcn`, never from subpaths
- Import icons from `@/components/emcn/icons` or `lucide-react`
- Import `cn` from `@/lib/core/utils/cn` for conditional class merging
- Import app-specific wrappers (Select, VerifiedBadge) from `@/components/ui`

---

## Design Tokens (CSS Variables)

Never use raw color values. Always use CSS variable tokens via Tailwind arbitrary values.

### Text hierarchy
- `text-[var(--text-primary)]` — Main content text
- `text-[var(--text-secondary)]` — Secondary/supporting text
- `text-[var(--text-tertiary)]` — Tertiary text
- `text-[var(--text-muted)]` — Disabled, placeholder text
- `text-[var(--text-icon)]` — Icon tinting
- `text-[var(--text-error)]` — Error/warning messages

### Surfaces
- `bg-[var(--bg)]` — Page background
- `bg-[var(--surface-2)]` through `bg-[var(--surface-7)]` — Increasing elevation
- `bg-[var(--surface-hover)]` — Hover backgrounds
- `bg-[var(--surface-active)]` — Active/selected backgrounds

### Borders
- `border-[var(--border)]` — Default borders
- `border-[var(--border-1)]` — Stronger borders (inputs, cards)

### Z-Index & Shadows
- Use z-index tokens: `--z-dropdown` (100), `--z-modal` (200), `--z-popover` (300), `--z-tooltip` (400), `--z-toast` (500)
- Use shadow tokens: `shadow-subtle`, `shadow-medium`, `shadow-overlay`, `shadow-card`

---

## Component Usage Rules

### Buttons
| Action type | Variant |
|-------------|---------|
| Primary action (create, save) | `primary` |
| Cancel, close | `default` |
| Delete, remove | `destructive` |
| Toolbar/icon-only | `ghost` |

### Delete Confirmations
Always Modal with: title "Delete {ItemType}", consequence text, `text-[var(--text-error)]` warning, Cancel (default) + Delete (destructive) buttons.

### Toast Notifications
Use imperative API: `toast.success(msg)`, `toast.error(msg)`. Never build custom notification UI.

### Badges
Green=success, red=error, amber=warning, blue=info, gray=neutral. Use `dot` prop for status indicators.

### Forms
Use `FormField` + `Input`/`Textarea` from emcn. Never raw HTML form elements.

### Loading States
Use `Skeleton` matching the actual UI structure dimensions.

---

## Anti-patterns to flag

- Raw HTML elements instead of emcn components
- Hardcoded colors instead of CSS variable tokens
- Custom modal/toast implementations
- Inline styles
- Missing `cn()` for conditional classes
- Wrong button variant for action type
- Importing from emcn subpaths instead of barrel
- Using arbitrary z-index instead of tokens
