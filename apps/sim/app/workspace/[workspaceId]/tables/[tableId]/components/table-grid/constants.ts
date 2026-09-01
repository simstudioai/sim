/** Tailwind class applied to selected rows / columns / cells. */
export const SELECTION_TINT_BG = 'bg-[rgba(37,99,235,0.06)]'

/**
 * Fill marking every cell matching the active find query. Reuses the app's
 * search-highlight token (the knowledge-base search highlight paints with the
 * same one) rather than inventing a third match colour, so the two stay
 * theme-tuned together. The ACTIVE match is told apart by the selection
 * outline drawn over it, not by a different fill.
 */
export const FIND_MATCH_TINT_BG = 'bg-[var(--highlight-match-bg)]'

/** Default column width in pixels. Used as a fallback when a column hasn't
 *  been measured yet and as the initial width for newly-added columns. */
export const COL_WIDTH = 160

/** Width of the "add column" placeholder column in pixels. */
export const ADD_COL_WIDTH = 120

/** Column config sidebar width in pixels — drives both the sidebar's own width
 *  and the table's reserved padding-right while a sidebar is open. */
export const COLUMN_SIDEBAR_WIDTH = 400

export const CELL =
  'border-[var(--border)] border-r border-b px-2 py-[7px] align-middle select-none'
/** `z-[6]` is load-bearing: the remote-selection overlay splits its layers around it so a
 *  peer's selection scrolled behind this cell is hidden by paint order. */
export const CELL_CHECKBOX =
  'sticky left-0 z-[6] border-[var(--border)] border-r border-b bg-[var(--bg)] px-0 py-[7px] align-middle select-none'
export const CELL_HEADER_CHECKBOX =
  'sticky left-0 z-[12] border-[var(--border)] border-r border-b bg-[var(--bg)] px-0 py-[7px] align-middle'
/** Fixed height (not min-) so a Badge-rendered status pill doesn't make the row grow vs a plain-text neighbor. */
export const CELL_CONTENT =
  'relative flex h-[22px] min-w-0 items-center overflow-clip text-ellipsis whitespace-nowrap text-small'
/** Inset shared by every full-cell overlay, so the tints and the selection
 *  outline can't drift apart on a border-geometry change. */
export const CELL_OVERLAY_INSET = 'pointer-events-none absolute -top-px -right-px -bottom-px'
export const SELECTION_OVERLAY = `${CELL_OVERLAY_INSET} z-[5] border-[2px] border-[var(--selection)]`
