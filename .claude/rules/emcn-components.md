---
paths:
  - "apps/sim/components/emcn/**"
---

# EMCN Components

Import from `@/components/emcn`, never from subpaths (except CSS files). The **chip family** is the platform's primary chrome — prefer it over the legacy primitives (`Input`, `Textarea`, etc.), which it is progressively replacing.

## Chip chrome — single source of truth

Never hand-roll the chip pill from raw class strings (they go stale). Compose from the canonical sources:

- **Surface + typography tokens:** `chip-input/chip-field-chrome.ts` — `chipFilledSurfaceTokens`, `chipFieldSurfaceClass`, `chipFieldTextClass`. Text fields and the dropdown search box build on these.
- **Pill geometry:** `chip/chip.tsx` — `chipVariants` (30px tall, `rounded-lg`, `px-2`, icon↔text `gap-1.5`). Every pill-shaped trigger (`ChipDropdown`, `ChipSelect`, `ChipSwitch`) reuses it for visual parity.

Canonical look: normal font-weight (never `font-medium`/`font-semibold`), value text `--text-body`, icons `--text-icon` at `size-[14px]`, placeholder `--text-muted`, `transition-colors`, **no focus ring** (the caret marks focus). Filled surface is `--surface-5` light / `--surface-4` dark with a `--border-1` border.

The menu surface intentionally diverges from the pill: `dropdown-menu.tsx` items use `text-small` and `gap-2` (a menu convention, not the chip pill). Keep them distinct.

## Component catalogue

- **`Chip` / `ChipLink`** — the pill button (`<button>` / Next `<Link>`). Variants: `ghost`, `filled`, `primary`, `destructive`, `border-shadow`. `leftIcon`/`rightIcon`, `active`, `fullWidth`, `flush`.
- **`ChipInput`** — single-line text field. `icon`, `endAdornment`, `error`, `inputClassName` (inner `<input>`); `className` styles the chrome wrapper.
- **`ChipTextarea`** — multi-line sibling. `error`, `resizable` (off by default).
- **`ChipDropdown`** — pill that opens a menu. Single OR multi-select via the discriminated `multiple` prop (one component, not two). Owns its trailing chevron — no `rightIcon`.
- **`ChipSelect` / `ChipCombobox`** — `Combobox`-backed pickers with search, groups, multi-select; for richer lists than `ChipDropdown`.
- **`ChipModal` + `ChipModalField`** — declarative compact modal. The field's `type` (`input` | `email` | `textarea` | `dropdown` | `file` | `emails` | `custom`) picks the control and **owns all chrome** — consumers describe intent, never pass `variant`/`className`/`id` to the inner control. `custom` is the escape hatch.
- **`ChipSwitch`** — segmented pill control (built from `chipVariants`).
- **`ChipTag`** — 20px inline tag/badge (`mono`/`gray`/`invite`), not a pill trigger.
- **`ChipDatePicker`** — chip-styled date field.

## Authoring principles

- **One source of truth for shared chrome.** Compose from `chip-field-chrome.ts` / `chipVariants`; never duplicate the chrome string.
- **`cn()` for a single state toggle, CVA for genuine multiple variants.** A lone `error` boolean is `cn()`, not a CVA variant.
- **Discriminated-union props for modes** (e.g. `multiple`, the modal field `type`) instead of near-duplicate components.
- **Delete legacy variants after migration** — don't leave dead paths (this paradigm removed `Input variant='chip'` and `ChipMultiSelect`).
- **Verify CSS vars exist.** An undefined var resolves to `currentColor` (caused a real black-border bug). Align to the canonical tokens: normal weight, `--text-body`, `--text-icon`.
- Use Radix UI primitives for accessibility. Export the component and its `variants` (when using CVA). Document with TSDoc + a usage example.
- Equal height/width → `size-*` (`size-[14px]`, `size-4`), never `h-[Npx] w-[Npx]` or `h-N w-N`. Default icon size is `size-[14px]`.
