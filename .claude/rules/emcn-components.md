---
paths:
  - "apps/sim/components/emcn/**"
---

# EMCN Components

Import components, `cn`, and tokens from the `@sim/emcn` barrel; icons come from the `@sim/emcn/icons` subpath, and CSS modules from their file path. Never deep-import other component subpaths. The **chip family** is the platform's primary chrome — always reach for it over the legacy primitives it is progressively replacing (`Input`→`ChipInput`, `Textarea`→`ChipTextarea`, `Modal`→`ChipModal`, `Select`/`Combobox`→`ChipSelect`/`ChipCombobox`/`ChipDropdown`, `Switch`→`ChipSwitch`, date field→`ChipDatePicker`). For context/action menus the canonical control is `DropdownMenu` — the standard menu (not a chip, and never a hand-rolled popover).

## Chip chrome — single source of truth

Never hand-roll the chip pill from raw class strings (they go stale). Compose from the canonical sources:

- **Surface, typography + content tokens:** `chip/chip-chrome.ts` — `chipFilledSurfaceTokens`, `chipFieldSurfaceClass`, `chipFieldTextClass` (text fields and the dropdown search box build on these), plus the chip-content chrome `chipContentGap`, `chipGeometryClass`, `chipContentIconClass`, `chipContentLabelClass`, and `cellIconNodeClass` (non-chip surfaces that must visually match chip content, e.g. resource table cells). All are re-exported from the `@sim/emcn` barrel — no subpath import needed.
- **Pill geometry:** `chip/chip.tsx` — `chipVariants` (30px tall, `rounded-lg`, `px-2`, icon↔text `gap-1.5`). Every pill-shaped trigger (`ChipDropdown`, `ChipSelect`, `ChipSwitch`) reuses it for visual parity.

Canonical look: normal font-weight (never `font-medium`/`font-semibold`), value text `--text-body`, icons `--text-icon` at `size-[14px]`, placeholder `--text-muted`, `transition-colors`, **no focus ring** (the caret marks focus). Filled surface is `--surface-5` light / `--surface-4` dark with a `--border-1` border.

The menu surface intentionally diverges from the pill: `dropdown-menu.tsx` items use `text-small` and `gap-2` (a menu convention, not the chip pill). Keep them distinct.

## Component catalogue

- **`Chip` / `ChipLink`** — the pill button (`<button>` / Next `<Link>`). Variants: `ghost`, `filled`, `primary`, `destructive`, `border-shadow`. `leftIcon`/`rightIcon`, `active`, `fullWidth`, `flush`.
- **`ChipInput`** — single-line text field. `icon`, `endAdornment`, `error`, `inputClassName` (inner `<input>`); `className` styles the chrome wrapper.
- **`ChipCopyInput`** — the canonical view-only field: a read-only `ChipInput` at full opacity with a trailing copy-to-clipboard button. View-only is a display mode, not a disabled state — reach for it (or `ChipModalField type='copy'`) over a `disabled` (greyed) input for values the user cannot edit.
- **`ChipTextarea`** — multi-line sibling. `error`, `resizable` (off by default), `viewOnly` (read-only at full opacity with the default cursor — the multi-line counterpart of `ChipCopyInput`).
- **`ChipDropdown`** — pill that opens a menu. Single OR multi-select via the discriminated `multiple` prop (one component, not two). Owns its trailing chevron — no `rightIcon`.
- **`ChipSelect` / `ChipCombobox`** — `Combobox`-backed pickers with search, groups, multi-select; for richer lists than `ChipDropdown`.
- **`ChipModal` + `ChipModalField`** — declarative compact modal. The field's `type` (`input` | `email` | `textarea` | `dropdown` | `copy` | `file` | `emails` | `custom`) picks the control and **owns all chrome** — consumers describe intent, never pass `variant`/`className`/`id` to the inner control. `custom` is the escape hatch. **Every body field MUST be a `ChipModalField`** — never hand-roll a field row (raw `<div>` + hand-rolled `<p>`/`<label>` title + bare `ChipInput`/`ChipTextarea`). `ChipModalBody` applies `px-2` + `gap-4`; `ChipModalField` adds another `px-2`, so each field lands at effective `px-4`, exactly matching the `px-4` header/footer — a hand-rolled row skips that gutter and sits misaligned at `px-2`. For controls the field doesn't cover (`ChipCombobox`, `ChipSelect`, `DatePicker`, `TimePicker`, `ButtonGroup`, arbitrary JSX), use `type='custom'` with a `title` — it still applies the gutter and renders the canonical `Label`.
- **`ChipSwitch`** — segmented pill control (built from `chipVariants`).
- **`ChipTag`** — 20px inline tag/badge (`mono`/`gray`/`invite`), not a pill trigger.
- **`ChipDatePicker`** — chip-styled date field.
- **`ChipTimePicker`** — minute-granular time sibling of `ChipDatePicker`, a `ChipInput` that leniently parses typed input (`9:47`, `947`, `2:05pm`, `14:30`), commits on Enter/blur, and re-renders the canonical `9:47 AM` label.
- **`DropdownMenu`** — the canonical context/action menu (Radix-backed). Not a chip, but the standard menu for command/action lists; reach for it instead of a hand-rolled popover. Its surface intentionally diverges from the chip pill (`text-small`, `gap-2`) — keep them distinct. For a pill that opens a value picker, use `ChipDropdown`/`ChipSelect` instead.

## Authoring principles

- **One source of truth for shared chrome.** Compose from `chip-chrome.ts` / `chipVariants`; never duplicate the chrome string.
- **`cn()` for a single state toggle, CVA for genuine multiple variants.** A lone `error` boolean is `cn()`, not a CVA variant.
- **Discriminated-union props for modes** (e.g. `multiple`, the modal field `type`) instead of near-duplicate components.
- **Delete legacy variants after migration** — don't leave dead paths (this paradigm removed `Input variant='chip'` and `ChipMultiSelect`).
- **Verify CSS vars exist.** An undefined var resolves to `currentColor` (caused a real black-border bug). Align to the canonical tokens: normal weight, `--text-body`, `--text-icon`.
- Use Radix UI primitives for accessibility. Export the component and its `variants` (when using CVA). Document with TSDoc + a usage example.

Color tokens and icon-size conventions are canonical in `.claude/rules/sim-styling.md` — follow it rather than restating.
