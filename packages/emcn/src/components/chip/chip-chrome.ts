/** The filled FILL (surface only, no border) — used by the borderless `filled` chip variant. */
export const chipFilledFillTokens = 'bg-[var(--surface-5)] dark:bg-[var(--surface-4)]'
/**
 * The filled surface WITH a `--border-1` border, for chip FIELDS ({@link ChipInput},
 * {@link ChipTextarea}). The `filled` chip variant itself is borderless
 * ({@link chipFilledFillTokens}); pill triggers (`ChipDropdown`/`ChipSelect`/
 * `ChipDatePicker`) opt into the border via `TRIGGER_BORDER_CLASS`.
 */
export const chipFilledSurfaceTokens = `border border-[var(--border-1)] ${chipFilledFillTokens}`
/**
 * The primary (inverse) chip fill at rest — dark fill, inverse text, mirrored in
 * dark mode. `chipVariants`' `primary` variant composes this with its hover
 * states; static chip-aligned highlights (e.g. calendar day-number pills) use it
 * directly. Like every token in this module, never re-derive the literal.
 */
export const chipPrimaryFillTokens =
  'bg-[var(--text-primary)] text-[var(--text-inverse)] dark:bg-white dark:text-[var(--bg)]'
/** The default chip corner radius. `chipVariants`' `shape: 'round'` swaps it for `rounded-full`. */
export const chipRadiusClass = 'rounded-lg'
/** Filled surface shared by the chip text fields ({@link ChipInput}, {@link ChipTextarea}) — aligned with `Chip` / `ChipDropdown`. */
export const chipFieldSurfaceClass = `${chipRadiusClass} ${chipFilledSurfaceTokens} transition-colors`
/**
 * The raised "border + drop shadow" ring of the `border-shadow` chip variant: a
 * 1px hairline ring plus a soft drop shadow, in both light and dark. Single
 * source for the variant ({@link chipVariants}) and for any non-chip surface
 * that must read as the same raised card (e.g. a landing media panel) — compose
 * it with `rounded-lg` + a fill rather than re-deriving the shadow literal.
 */
export const chipBorderShadowRing =
  'shadow-[0_0_0_1px_rgba(28,40,64,0.08),0_1px_3px_0_rgba(28,40,64,0.1)] dark:shadow-[0_0_0_1px_var(--border-1),0_1px_3px_0_rgba(0,0,0,0.3)]'
/**
 * Typography shared by the chip text fields — normal weight, `--text-body`, muted
 * placeholder, no focus outline.
 *
 * `[letter-spacing:inherit]` undoes the UA stylesheet, which pins form controls to
 * `letter-spacing: normal`. Without it a chip field's text tracks differently from
 * the labels around it, and any transparent-field-over-mirror overlay diverges from
 * its mirror by the inherited tracking on every character — so the caret drifts
 * further from the visible text the longer the value. Matches `Input`/`Textarea`.
 */
export const chipFieldTextClass =
  'text-[var(--text-body)] text-sm [letter-spacing:inherit] outline-none placeholder:text-[var(--text-muted)]'

/**
 * Icon↔label gap of the canonical chip-content row — the icon↔label pair inside
 * a chip pill. Single source for `chipVariants`' base gap and for any non-chip
 * surface that must visually match chip content (e.g. resource table cells).
 * Like every token in this module, never re-derive the literal; import it.
 */
export const chipContentGap = 'gap-1.5'

/**
 * Chip pill geometry minus its corner radius — height, centering, gap, padding,
 * text size. `chipVariants` composes this with its `shape` variant so a raw
 * (non-`cn`) consumer never emits two competing radii; everything else reads
 * {@link chipGeometryClass}, which adds the default radius back.
 */
export const chipGeometryUnroundedClass = `h-[30px] items-center ${chipContentGap} px-2 text-left text-sm`
/**
 * Chip pill geometry — height, centering, gap, radius, padding, text size — with
 * NO interactivity (no `cursor-pointer`, no hover). `chipVariants` composes this
 * for its base; static, chip-aligned surfaces (e.g. the resource header's
 * current-location label or a non-navigable breadcrumb) reuse it directly to
 * match a chip's shape without inheriting its hover.
 */
export const chipGeometryClass = `${chipGeometryUnroundedClass} ${chipRadiusClass}`
/** Chip-content icon (non-inverse): 16px, non-shrinking, `--text-icon`. Inverse chip variants override the color to `currentColor`. */
export const chipContentIconClass = 'size-[16px] flex-shrink-0 text-[var(--text-icon)]'
/** Fade-free single-line fallback for rich chip content. Plain text labels should render through `OverflowText`. */
export const chipContentLabelClass =
  'min-w-0 overflow-hidden text-clip whitespace-nowrap text-[var(--text-body)] text-sm'

/**
 * The two row surfaces. Mutually exclusive — a row paints one OR the other,
 * never both, so a selected row holds its surface through hover.
 *
 * Hover used to be `--surface-active` (a hovered row looked selected, so lists
 * appeared to have two selections) and active used to brighten to `--surface-6`
 * on hover (read as the selection changing under the cursor). Do not reintroduce
 * either. `chipVariants` wires this for pills; hand-rolled rows import these
 * rather than restating the literals.
 */
export const chipHoverSurfaceClass = 'hover-hover:bg-[var(--surface-hover)]'
/** @see {@link chipHoverSurfaceClass} — the selected half of the same pair. */
export const chipActiveSurfaceClass = 'bg-[var(--surface-active)]'
/**
 * The third row surface: a drag is over this row and releasing would file into it.
 *
 * Neutral by design — hue is not how this app signals "release here"; the workflow sidebar's
 * own drop affordance is a `--text-subtle` tint. Drawn inside the element's own box so the ring
 * never overlaps its neighbours. Hand-rolled rows and breadcrumb crumbs import this rather than
 * restating the literal, so every drop destination reads identically.
 *
 * Fills to `--surface-active`, the same weight as a selected row, and leans on the ring to tell
 * the two apart. Not `--surface-4`: that is the button-base token, and in light mode it is
 * *lighter* than `--surface-hover`, so the row under the cursor read weaker the moment it became
 * a drop target — the strongest state painting the faintest fill.
 */
export const chipDropTargetSurfaceClass = `${chipActiveSurfaceClass} outline outline-1 outline-[var(--text-subtle)] outline-offset-[-1px]`
/**
 * The disclosure chevron that rotates to expand or collapse a sidebar section or a
 * tree row: 14px at `--text-icon`, animating on the same 150ms curve the section
 * body expands on so the chevron and what it reveals read as one gesture. Opacity
 * is in the property list for the consumers that also fade the chevron in.
 *
 * Single source for the sidebar section headers and the two sidebar trees. Other
 * collapsible surfaces still carry their own literals at 8-12px and 100-200ms;
 * migrating them onto this token is the remaining half of the consolidation.
 */
export const disclosureChevronClass =
  'size-[14px] flex-shrink-0 text-[var(--text-icon)] transition-[opacity,transform] duration-150'
/** The 16px square a chip-row icon or chevron centers in, so every row's label starts on the same baseline. */
export const chipIconSlotClass = 'inline-flex size-[16px] flex-shrink-0 items-center justify-center'
/**
 * Force-sizes a PRE-RENDERED icon node (`<svg>`/`<img>`/`<span>` avatar) to the
 * 14px resource-row standard + `--text-icon` color — regardless of the size the
 * consumer passed — so every table-row icon across every consumer matches (the
 * resource rows run the app's default 14px icons, not the 16px chip-pill icon).
 * Element-type child selectors out-specify the node's own `size-*`, so it wins
 * without editing any consumer cell builder.
 *
 * This token serves resource-table ROW CELLS, not chip content itself. It lives
 * in this module deliberately: the same cell builders compose it with
 * {@link chipContentGap} to keep table cells visually aligned with chip
 * content, and chip-chrome is the single home for that shared icon/label
 * chrome — do not relocate it to a table-specific module.
 */
export const cellIconNodeClass =
  'inline-flex flex-shrink-0 items-center text-[var(--text-icon)] [&>svg]:size-[14px] [&>img]:size-[14px] [&>span]:size-[14px]'
