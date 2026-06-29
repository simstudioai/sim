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
/** Filled surface shared by the chip text fields ({@link ChipInput}, {@link ChipTextarea}) — aligned with `Chip` / `ChipDropdown`. */
export const chipFieldSurfaceClass = `rounded-lg ${chipFilledSurfaceTokens} transition-colors`
/** Typography shared by the chip text fields — normal weight, `--text-body`, muted placeholder, no focus outline. */
export const chipFieldTextClass =
  'text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)]'

/**
 * Icon↔label gap of the canonical chip-content row — the icon↔label pair inside
 * a chip pill. Single source for `chipVariants`' base gap and for any non-chip
 * surface that must visually match chip content (e.g. resource table cells).
 * Like every token in this module, never re-derive the literal; import it.
 */
export const chipContentGap = 'gap-1.5'
/**
 * Chip pill geometry — height, centering, gap, radius, padding, text size — with
 * NO interactivity (no `cursor-pointer`, no hover). `chipVariants` composes this
 * for its base; static, chip-aligned surfaces (e.g. the resource header's
 * current-location label or a non-navigable breadcrumb) reuse it directly to
 * match a chip's shape without inheriting its hover.
 */
export const chipGeometryClass = `h-[30px] items-center ${chipContentGap} rounded-lg px-2 text-left text-sm`
/** Chip-content icon (non-inverse): 16px, non-shrinking, `--text-icon`. Inverse chip variants override the color to `currentColor`. */
export const chipContentIconClass = 'size-[16px] flex-shrink-0 text-[var(--text-icon)]'
/** Chip-content label (non-inverse): truncating `--text-body` at `text-sm`. Inverse chip variants override the color to `currentColor`. */
export const chipContentLabelClass = 'min-w-0 truncate text-[var(--text-body)] text-sm'
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
