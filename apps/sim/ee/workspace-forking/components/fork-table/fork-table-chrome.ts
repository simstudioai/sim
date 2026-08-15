import { chipFilledFillTokens } from '@sim/emcn'

/**
 * Table chrome for the Forks console, mirroring the emcn `Table` exactly.
 *
 * The console needs three things the shared table deliberately does not offer — tree rails on a
 * row, a row that expands into a panel, and a pinned first column for the mappings matrix — so it
 * draws its own card rather than widening the platform component for one caller. Every literal
 * below is the one `packages/emcn/src/components/table/table.tsx` uses, kept here as the single
 * source for the console's own rows so the two surfaces stay pixel-identical.
 */

/** The card the table paints on, which the row checkboxes pin their fill to. */
export const FORK_TABLE_SURFACE_CLASS = 'bg-[var(--surface-2)]'

/** Bordered, horizontally scrollable card. */
export const FORK_TABLE_CARD_CLASS = `min-h-0 min-w-0 overflow-x-auto rounded-lg border border-[var(--border)] ${FORK_TABLE_SURFACE_CLASS}`

/** Tinted header band. */
export const FORK_TABLE_HEAD_CLASS = chipFilledFillTokens

/** Header cells: muted, normal-weight, 12px, with a 12px gutter at both card edges. */
export const FORK_TABLE_HEADER_CELL_CLASS =
  'px-2 py-2 text-left align-middle font-normal text-[var(--text-muted)] text-caption first:pl-3 last:pr-3'

/** Row cells: an 8px inner rhythm with a 12px gutter at both card edges. */
export const FORK_TABLE_CELL_CLASS = 'px-2 py-2.5 align-middle first:pl-3 last:pr-3'

/** Value text inside a row cell. */
export const FORK_TABLE_CELL_TEXT_CLASS = 'text-[var(--text-body)] text-small'

/** Row separator, dropped on the final row so the card's own border closes it. */
export const FORK_TABLE_ROW_CLASS =
  'border-[var(--border)] border-b transition-colors last:border-b-0'

/** The empty / loading cell that spans the full width of the card. */
export const FORK_TABLE_STATUS_CELL_CLASS =
  'px-3 py-10 text-center text-[var(--text-muted)] text-small'

/**
 * Focus affordance for controls that suppress the native outline — the same soft halo the shared
 * table, `Switch`, and `Slider` draw, flush against the control so it reads identically on the
 * tinted header band and on a row.
 */
export const FORK_TABLE_FOCUS_RING_CLASS =
  'focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--text-muted)_30%,transparent)]'

/** Vertical rhythm between the tab strip, the toolbar, and the card. */
export const FORK_TABLE_STACK_CLASS = 'flex min-w-0 flex-col gap-3'

/**
 * Indent per tree level, matching the workflow sidebar's `TREE_SPACING.INDENT_PER_LEVEL` so a fork
 * tree and a folder tree step at the same rate.
 */
export const FORK_TREE_INDENT_PER_LEVEL = 20

/**
 * Horizontal centre of a level's rail within its indent step. Half of
 * {@link FORK_TREE_INDENT_PER_LEVEL} minus the hairline, so the elbow meets the drop line squarely.
 */
export const FORK_TREE_RAIL_OFFSET = 9
