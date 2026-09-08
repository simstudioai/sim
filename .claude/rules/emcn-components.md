---
paths:
  - "packages/emcn/**"
---

# EMCN Components

Import components, `cn`, and tokens from the `@sim/emcn` barrel; icons come from the `@sim/emcn/icons` subpath, and CSS modules from their file path. Never deep-import other component subpaths. The **chip family** is the platform's primary chrome — always reach for it over the legacy primitives it is progressively replacing (`Input`→`ChipInput`, `Textarea`→`ChipTextarea`, `Modal`→`ChipModal`, `Select`/`Combobox`→`ChipSelect`/`ChipCombobox`/`ChipDropdown`, `Switch`→`ChipSwitch`, date field→`ChipDatePicker`). For context/action menus the canonical control is `DropdownMenu` — the standard menu (not a chip, and never a hand-rolled popover).

## Chip chrome — single source of truth

Never hand-roll the chip pill from raw class strings (they go stale). Compose from the canonical sources:

- **Surface, typography + content tokens:** `chip/chip-chrome.ts` — `chipFilledSurfaceTokens`, `chipFieldSurfaceClass`, `chipFieldTextClass` (text fields and the dropdown search box build on these), plus the chip-content chrome `chipContentGap`, `chipGeometryClass`, `chipContentIconClass`, `chipContentLabelClass`, `cellIconNodeClass` (non-chip surfaces that must visually match chip content, e.g. resource table cells), and the row-state pair `chipHoverSurfaceClass` / `chipActiveSurfaceClass` (hover vs. selected — mutually exclusive, so a selected row holds its surface through hover; every hand-rolled row imports these rather than restating the literals). All are re-exported from the `@sim/emcn` barrel — no subpath import needed.
- **Pill geometry:** `chip/chip.tsx` — `chipVariants` (30px tall, `rounded-lg`, `px-2`, icon↔text `gap-1.5`). Every pill-shaped trigger (`ChipDropdown`, `ChipSelect`, `ChipSwitch`) reuses it for visual parity.

Canonical look: normal font-weight (never `font-medium`/`font-semibold`), value text `--text-body`, icons `--text-icon` at `size-[14px]`, placeholder `--text-muted`, `transition-colors`, **no focus ring** (the caret marks focus). Filled surface is `--surface-5` light / `--surface-4` dark with a `--border-1` border.

The menu surface intentionally diverges from the pill: `dropdown-menu.tsx` items use `text-small` and `gap-2` (a menu convention, not the chip pill). Keep them distinct.

## Component catalogue

- **`Chip` / `ChipLink`** — the pill button (`<button>` / Next `<Link>`). Variants: `primary`, `destructive`, `border-shadow`, `border`, `outline` (a true `--border` border, no shadow or hover fill); the bare chip is implicit (omit `variant`). `filled` is deliberately NOT a `Chip` variant — it is reserved for chip fields/triggers. For a selected/toggle chip use the `active` prop, never a variant. `leftIcon`/`rightIcon`, `active`, `fullWidth`. Chips carry **no outer margin** — space between them is the parent's `gap`. The old `mx-0.5` default and its `flush` opt-out are gone; do not reintroduce either, and never add a margin to a chip through `className`.
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
- **`useScrollEdges` + `scrollFadeClass` / `scrollFadeAttributes`** — the canonical scroll-region edge treatment. The hook reports which edges hide content (tracking scroll and resizes; pass the element itself, held in state, when the region mounts after its owner, e.g. inside a Radix portal); the class and attributes fade a fixed 12px band at an active edge only, so a list that fits or sits at its top is never fogged. A floating control over the top edge sets `--scroll-fade-inset` to its height. A region that scrolls sideways (a tab row, a chip strip) uses `useScrollEdges(ref, { axis: 'x' })` with `scrollFadeXClass`; the attributes helper is shared. Any divider beside the region belongs to the neighboring block (`border-b` above, `border-t` below), never to the masked element, and shows only while that edge is active. Never hand-roll a `mask-image` gradient for a scroll region.
- **`OverflowText`** — the canonical single-line overflow treatment for read-only human labels and titles. It owns `min-w-0`, fade-only clipping (never an ellipsis), the conditional 18px edge mask, and the full-value floating tooltip; consumers pass only layout/typography through `className`. `overflowTextClipClass` and `overflowTextFadeClass` are the complete base/faded treatments for the rare component that must own measurement itself; never pair either with `truncate`, `text-ellipsis`, or hover-time mask removal. Use `DropdownMenuItemLabel` for a menu label beside icons, checks, or actions. A non-editable `Combobox` passes the full visual value through `overlayLabel`; the combobox owns the visual overlay's fade and keeps its one accessible tooltip on the interactive layer. Keep ordinary `truncate` only for editable values, code/log/path content, dense or virtualized grids, and rich composite content that cannot supply a plain tooltip label. Multiline copy uses an intentional `line-clamp-*` treatment instead.

## Modal keyboard defaults

Declare keyboard intent on the action-owning primitive; never add document-level or per-callsite Enter listeners.

- `ChipModalFooter` defaults to `defaultAction='primary'`. A plain Enter in a canonical single-line field or a custom plain input invokes the enabled primary action. Use `'none'` when submission must require an explicit click, such as an irreversible destructive action or an editor whose nested control owns Enter. Use `'dismiss'` only when dismissal is genuinely the modal's default decision.
- `ChipConfirmModal` fails safe with `defaultAction='dismiss'`. Opt into `'confirm'` only for an audited, low-impact reversible or non-destructive decision. Deleting an aggregate resource such as a workflow, table, knowledge base, or folder remains `'dismiss'` even when it can be restored, because the action takes a broad dependent graph offline. Use `'none'` for typed confirmations and severe account, ownership, or access changes. Button color never determines keyboard behavior.
- Textareas, native forms, buttons, links, comboboxes, menus, listboxes, tag/email inputs, IME composition, modified Enter, and disabled or pending actions retain their native behavior. A native form remains the sole submission path so browser validation is not bypassed.
- A custom field containing a search, token editor, or another input that owns Enter must set `submitOnEnter={false}` on `ChipModalField`. Do not attach a duplicate `onKeyDown` handler merely to call the footer action.
- Initial focus goes to the first visible editable text control. With no text control, the declared real button receives focus; `'none'` focuses the dialog surface. A safe dismiss default never turns Enter in a text field into data loss—the field simply does not publish a submit action.

## Authoring principles

- **One source of truth for shared chrome.** Compose from `chip-chrome.ts` / `chipVariants`; never duplicate the chrome string.
- **`cn()` for a single state toggle, CVA for genuine multiple variants.** A lone `error` boolean is `cn()`, not a CVA variant.
- **Discriminated-union props for modes** (e.g. `multiple`, the modal field `type`) instead of near-duplicate components.
- **Delete legacy variants after migration** — don't leave dead paths (this paradigm removed `Input variant='chip'` and `ChipMultiSelect`).
- **Verify CSS vars exist.** An undefined var resolves to `currentColor` (caused a real black-border bug). Align to the canonical tokens: normal weight, `--text-body`, `--text-icon`.
- Use Radix UI primitives for accessibility. Export the component and its `variants` (when using CVA). Document with TSDoc + a usage example.

Color tokens and icon-size conventions are canonical in `.claude/rules/sim-styling.md` — follow it rather than restating.
