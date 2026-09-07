---
paths:
  - "apps/sim/**/*.tsx"
  - "apps/sim/**/*.css"
---

# Styling Rules

## Tailwind

1. **No inline styles** - Use Tailwind classes. Exception: a genuinely dynamic
   value (a hashed avatar colour, a brand tile background) that cannot be a class.
2. **No duplicate dark classes** - Skip `dark:` when value matches light mode
3. **Exact values over approximations** - `h-[26px]`, not `h-6`. But **type size is
   always a named token** (`text-sm`, `text-caption`) — never `text-[14px]`, which
   sets font-size only and inherits a different line-height. See
   `sim-settings-pages.md` for the scale.
4. **Transitions** - `transition-colors` for interactive states

## Conditional Classes

```typescript
import { cn } from '@sim/emcn'

<div className={cn(
  'base-classes',
  isActive && 'active-classes',
  disabled ? 'opacity-60' : 'hover:bg-accent'
)} />
```

## CSS Variables

For dynamic values (widths, heights) synced with stores:

```typescript
// In store
setWidth: (width) => {
  set({ width })
  document.documentElement.style.setProperty('--sidebar-width', `${width}px`)
}

// In component
<aside style={{ width: 'var(--sidebar-width)' }} />
```

## Text Scale

Custom font sizes (the `@theme` block in `apps/sim/app/_styles/globals.css`): `text-micro`=10px, `text-xs`=11px, `text-caption`=12px, `text-small`=13px, `text-base`=15px. `text-sm` is Tailwind default 14px. Field titles use `text-small` (13px); hints/errors use `text-caption` (12px).

Icons default `size-[14px]`. Equal h/w → `size-*` (`size-[14px]`, `size-4`), never `h-N w-N`.

## Text Overflow

Use `OverflowText` from `@sim/emcn` for a constrained, single-line, read-only human label or title. It owns `min-w-0`, fade-only clipping, the conditional edge mask, and the full-value floating tooltip; pass only layout and typography through `className`. Never combine a fade or hand-written `mask-image` with `truncate`/`text-ellipsis`, and never remove the mask on hover to reveal an ellipsis. Pass the full label instead of shortening it in JavaScript first. Components that must measure a label externally use the complete `overflowTextClipClass` + conditional `overflowTextFadeClass` pair.

For a non-editable `Combobox` visual overlay, pass the same full plain value as `overlayLabel`. The combobox owns the visible overlay's fade and keeps the one reachable full-value tooltip on its interactive layer; consumers provide only the overlay's decorated content.

Use `DropdownMenuItemLabel` for a human label beside menu icons, checks, shortcuts, or actions. Bare string children are wrapped automatically; a direct rich `<span>` is only a hard-clipped escape hatch and must not be used for an ordinary text label.

Do not apply the fade universally to editable or mirrored input values, code, logs, paths, filenames that use intentional middle truncation, dense or virtualized grids, or a composite container that also holds icons/actions. Those keep their purpose-built overflow behavior. Multiline copy uses an intentional `line-clamp-*` treatment.

## Scroll Edges

A scroll region that can hide rows past an edge uses `useScrollEdges` with `scrollFadeClass` + `scrollFadeAttributes` from `@sim/emcn`: a 12px fade at an edge only while content is hidden beyond it, never at rest. The region's baseline padding lives on the scroll box itself (so rows pass through it under the fade), and the divider at that edge is drawn by the neighboring block, conditional on the same edge. Never hand-roll a `mask-image` gradient or a `scrollTop > 0` effect for this.

## Font Weight

Three steps, Tailwind's stock scale, nothing else: **`font-normal` (400)**, **`font-medium` (500)**, **`font-semibold` (600)**. 400 is the document default, so body text, chip labels, sidebar items, and headings carry **no weight class at all** — they inherit. Reach for a class only to step *up* from body.

Never write an arbitrary weight (`font-[380]`, `font-[430]`, `font-[450]`, …), and never set `fontWeight` in an inline `style`. There was previously a CSS-variable weight scale (`--font-weight-base/medium/semibold`, remapping `font-medium` to 440/480) plus seven ad-hoc values clustered between 380 and 500; it was deleted because nothing read as hierarchical. Off-scale values are only acceptable where the design system genuinely cannot reach — react-email templates and the static `apps/sim/emails/broadcasts/*.html`, which email clients render without CSS variables.

Headings inherit their weight. Tailwind preflight resets `h1`–`h6` to `font-weight: inherit`, so an `<h1>` is 400 unless you say otherwise — that is the intended look, not a bug to patch.

## Color Tokens

Value text `--text-body`; muted/placeholder/labels `--text-muted`; icons `--text-icon`; progress and completion (a checked step, a done state) `--brand-blue` — `--selection` stays the interactive highlight; neutral borders and dividers `--border` (`--border-1` and `--border-muted` are legacy aliases resolving to it; `--divider` is retired); surfaces `--surface-5` (light) / `--surface-4` (dark); active row `--surface-active`; error `--text-error`. No focus rings on chip surfaces.

### Line weight

Neutral border geometry comes from `--border-width`: `1px` by default, dropping to `0.5px` under `@media (min-resolution: 2dppx)` so hidpi displays get a true hairline. Tailwind's `border*` and `divide-*` utilities resolve through it, as do `h-px`/`w-px` — the `px` key is overridden on **`spacing`**, not on `width`/`height`, so a hairline and the `-right-px`/`inset-px` offsets that position it stay in agreement.

**Tune line weight on `--border`, never on `--border-width`.** Browsers floor a border to whole device pixels, so on a 2dppx display every value in `(0, 1px)` collapses to the same single-pixel hairline and the next drawable step is a full `1px` — double. Width has exactly one usable position; perceived weight is a color property. Light mode gains weight by darkening `--border`, dark mode by lightening it.

Draw a line with a real `border-*` utility. Never hand-roll one as `shadow-[inset_0_-1px_0_…]` — box-shadow has its own width and cannot follow the token, so such a line silently renders at double weight against every neighbor. Use an explicit numeric width (or a `ring`/`outline`) only when the line is intentionally emphasized, e.g. focus and selection affordances.

## Chip Components (consumer usage)

`ChipInput`, `ChipTextarea`, `ChipModal*` own their full chrome. Consumers describe intent through PROPS; they never re-style the chrome. The canonical chrome lives in `packages/emcn/src/components/chip/chip-chrome.ts` (all tokens are re-exported from the `@sim/emcn` barrel — no subpath import needed) — never hand-roll `rounded-lg`/`border`/`bg-[var(--surface-5)]`/`h-[30px]`/`px-2`/`text-sm`/focus rings.

### Props over className

- **Errors** → `error` prop. Never `className={cn(err && 'border-[var(--text-error)]')}`.
- **Leading icon** → `icon` prop (rendered 14px in `--text-icon`).
- **Trailing buttons** (reveal/copy/fetch) → `endAdornment`.
- **Inner-input styling** (e.g. `font-mono`, number-spinner reset) → `inputClassName` (ChipInput only). See `app/workspace/[workspaceId]/settings/components/billing/components/usage-limit-field/usage-limit-field.tsx:117`.
- **`ChipModalField` controls take NO className.** Pass `title`/`value`/`onChange`/`error`/`hint`/`required`/`flush`. The field owns label, control, and error/hint rendering. See `app/workspace/[workspaceId]/skills/components/skill-modal/skill-modal.tsx:170`.

### What className MAY carry

Layout/sizing ONLY: `flex-1`, `w-full`, `w-[Npx]`, `min-w-0`, `max-w-*`, margins. `truncate` is allowed only for the explicit overflow exceptions above, never as a general layout class. Example: `<ChipInput icon={Search} className='min-w-0 flex-1' .../>` (`app/workspace/[workspaceId]/integrations/integrations.tsx:257`). NEVER re-specify canonical chrome — the component already applies it.

### Form / chip-modal layout rhythm

- **Field row** = `ChipModalField`: label↔control `gap-[9px]`, field gutter `px-2` (`px-0` when `flush`). Title = `Label` at `text-small` (13px), muted, normal weight; hint/error at `text-caption` (12px).
- **Modal body** (`ChipModalBody`): `gap-4` between fields, padding `px-2 pt-4 pb-4.5`.
- **Header/footer**: horizontal gutter `px-4` (header `pt-3`; footer `px-4 pt-2 pb-2`, tinted bar).
- **Every body field MUST be a `ChipModalField`** — NEVER hand-roll a field row (raw `<div>` + hand-rolled `<p>`/`<label>` title + bare `ChipInput`/`ChipTextarea`). WHY: body `px-2` + field `px-2` = effective `px-4`, exactly matching the `px-4` header/footer. A hand-rolled row skips the field gutter, sits at `px-2`, and is visibly misaligned (this bug shipped in the scheduled-tasks "Create new scheduled task" modal). Inline errors go through the `error` prop, not a hand-rolled `<p>`.
- **Uncovered controls** (`ChipCombobox`, `ChipSelect`, `DatePicker`, `TimePicker`, `ButtonGroup`, arbitrary JSX) → `ChipModalField type='custom'` with a `title`. It still applies the `px-2` gutter and renders the canonical `Label`, so it stays aligned. Never drop such a control into a raw `<div>`, and never add a body-level wrapper `<div>` with a custom `gap-*` that fights `gap-4`.
- **Page section rhythm** (integrations/skills/settings): muted `text-small` label + `mt-[9px] mb-3 h-px bg-[var(--border)]` divider, sections stacked `gap-7`. Reuse `SettingsSection` (`app/workspace/[workspaceId]/settings/components/settings-section/settings-section.tsx`) rather than re-deriving it.

When a standalone labeled field outside a `ChipModal` needs the same look (e.g. `SkillImport`), match the field rhythm by hand: `flex flex-col gap-[9px]`, muted label, `ChipInput`/`ChipTextarea` control, `text-caption` error below.
