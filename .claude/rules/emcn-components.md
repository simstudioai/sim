---
description: EMCN component library patterns
paths:
  - "packages/emcn/**"
---

# EMCN Components

Import components, `cn`, and tokens from the `@sim/emcn` barrel; icons come from the `@sim/emcn/icons` subpath, and CSS modules from their file path. Never deep-import other component subpaths. The **chip family** is the platform's primary chrome — always reach for it over the legacy primitives it is progressively replacing (`Input`→`ChipInput`, `Textarea`→`ChipTextarea`, `Modal`→`ChipModal`, `Select`/`Combobox`→`ChipSelect`/`ChipCombobox`/`ChipDropdown`, `Switch`→`ChipSwitch`, date field→`ChipDatePicker`). For context/action menus the canonical control is `DropdownMenu` — the standard menu (not a chip, and never a hand-rolled popover).

## Chip chrome — single source of truth

Never hand-roll the chip pill from raw class strings (they go stale). Compose from the canonical sources:

- **Surface, typography + content tokens:** `chip/chip-chrome.ts` — `chipFilledSurfaceTokens`, `chipFieldSurfaceClass`, `chipFieldTextClass` (text fields and the dropdown search box build on these), plus the chip-content chrome `chipContentGap`, `chipGeometryClass`, `chipContentIconClass`, `chipContentLabelClass`, `cellIconNodeClass` (non-chip surfaces that must visually match chip content, e.g. resource table cells), and the row-state pair `chipHoverSurfaceClass` / `chipActiveSurfaceClass` (hover vs. selected — mutually exclusive, so a selected row holds its surface through hover; every hand-rolled row imports these rather than restating the literals). All are re-exported from the `@sim/emcn` barrel — no subpath import needed.
- **Pill geometry:** `chip/chip.tsx` — `chipVariants` (30px tall, `rounded-lg`, `px-2`, icon↔text `gap-1.5`). Every pill-shaped trigger (`ChipDropdown`, `ChipSelect`, `ChipSwitch`) reuses it for visual parity.

Canonical look: normal font-weight (never `font-medium`/`font-semibold`), value text `--text-body`, icons `--text-icon` at `size-[14px]`, placeholder `--text-muted`, `transition-colors`, **no focus ring** (the caret marks focus). Filled surface is `--surface-5` light / `--surface-4` dark with a `--border` border (`chip-chrome.ts` still spells it through the legacy alias `--border-1`; new code writes `--border`).

The menu surface intentionally diverges from the pill: `dropdown-menu.tsx` items use `text-small` and `gap-2` (a menu convention, not the chip pill). Keep them distinct.

## Public components and design behavior

The current public exports, variants, defaults, styling slots, and relationships are derived directly from source by the design check and full scanner. Run `bun run check:design --base origin/staging --working-tree` when EMCN or `globals.css` changes. Browse and interact with visual exports in the local Design Studio after `bun run studio:refresh`; do not maintain an export list here.

Use chip fields and triggers for product forms, and `DropdownMenu` for context and action lists. Prefer a supported prop to a `className` chrome override. A selected chip uses `active`; outer spacing belongs to its parent. A view-only value stays at full opacity and uses the read-only copy field or `ChipModalField type='copy'`, not a disabled input. `ChipModalField` owns its inner control chrome; use `type='custom'` with a title for a control it does not cover. A chip dropdown owns its chevron and supports single or multi-select through `multiple`; use chip select or combobox for searchable or grouped lists. Inline tags are labels, not pill triggers.

For scroll-region edge fading use `useScrollEdges` with `scrollFadeClass` or `scrollFadeXClass` and `scrollFadeAttributes`; do not hand-roll a mask. For a constrained, single-line, read-only human label use `OverflowText` or `DropdownMenuItemLabel` in a menu; keep its fade and full-value tooltip instead of adding an ellipsis. Keep editable values, code, logs, paths, dense grids, and composite content on their appropriate overflow treatments. Source and variants in EMCN remain the authority if these examples change.

## Modal keyboard defaults

Declare keyboard intent on the action-owning primitive; never add document-level or per-callsite Enter listeners.

- `ChipModalFooter` defaults to `defaultAction='primary'`. A plain Enter in a canonical single-line field or a custom plain input invokes the enabled primary action. Use `'none'` when submission must require an explicit click, such as an irreversible destructive action or an editor whose nested control owns Enter. Use `'dismiss'` only when dismissal is genuinely the modal's default decision.
- `ChipConfirmModal` fails safe with `defaultAction='dismiss'`. Opt into `'confirm'` only for an audited, low-impact reversible or non-destructive decision. Deleting an aggregate resource such as a workflow, table, knowledge base, or folder remains `'dismiss'` even when it can be restored, because the action takes a broad dependent graph offline. Use `'none'` for typed confirmations and severe account, ownership, or access changes. Button color never determines keyboard behavior.
- Textareas, native forms, buttons, links, comboboxes, menus, listboxes, tag/email inputs, IME composition, modified Enter, and disabled or pending actions retain their native behavior. A native form remains the sole submission path so browser validation is not bypassed.
- A custom field containing a search, token editor, or another input that owns Enter must set `submitOnEnter={false}` on `ChipModalField`. Do not attach a duplicate `onKeyDown` handler merely to call the footer action.
- Initial focus goes to the first visible editable text control. With no text control, the declared real button receives focus; `'none'` focuses the dialog surface. A safe dismiss default never turns Enter in a text field into data loss—the field simply does not publish a submit action.

## Authoring principles

- **One source of truth for shared chrome.** Compose from `chip-chrome.ts` / `chipVariants`; never duplicate the chrome string.
- **Props over `className` overrides.** When a consumer needs to change chrome, expose a prop (`error`, `icon`, `endAdornment`, `inputClassName`); reaching for `className` to restyle chrome is the smell.
- **`cn()` for a single state toggle, CVA for genuine multiple variants.** A lone `error` boolean is `cn()`, not a CVA variant.
- **Discriminated-union props for modes** (e.g. `multiple`, the modal field `type`) instead of near-duplicate components.
- **Delete legacy variants after migration** — don't leave dead paths (this paradigm removed `Input variant='chip'` and `ChipMultiSelect`).
- **Verify CSS vars exist.** An undefined var resolves to `currentColor` (caused a real black-border bug). Align to the canonical tokens: normal weight, `--text-body`, `--text-icon`.
- Use Radix UI primitives for accessibility. Export the component and its `variants` (when using CVA). Document with TSDoc + a usage example.

Color tokens and icon-size conventions are canonical in `.claude/rules/sim-styling.md` — follow it rather than restating.

## Source-derived design contracts

The diff check derives public API, styling, recipe and ownership facts from both source revisions; the full scan publishes current facts in `scan.json`. Ownership is derived from implementation; exceptional customization and protection decisions belong in `packages/emcn/src/design-ownership.json` with a reason. Review central source changes in the diff findings. Browser reports and captures remain local, outside the repository.
