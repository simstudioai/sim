import { chipGeometryClass } from '@sim/emcn'

/**
 * Terminal filter configuration state
 */
export interface TerminalFilters {
  blockIds: Set<string>
  statuses: Set<'error' | 'info'>
}

/**
 * Context menu position for positioning floating menus
 */
export interface ContextMenuPosition {
  x: number
  y: number
}

/**
 * Sort direction options
 */
export type SortDirection = 'asc' | 'desc'

/**
 * Status type for console entries
 */
export type EntryStatus = 'error' | 'info'

/**
 * Block information for filters
 */
export interface BlockInfo {
  blockId: string
  blockName: string
  blockType: string
}

/**
 * Common row styling classes for terminal components.
 *
 * A log row is a chip: it takes its height, radius, padding, gap and text size
 * from the canonical pill geometry, and its hover/selected surfaces from the
 * same two-step model `chipVariants` gives every other row in the workspace —
 * hover one step below selected, and selection held through hover.
 */
export const ROW_STYLES = {
  base: `group flex cursor-pointer justify-between ${chipGeometryClass} transition-colors`,
  selected: 'bg-[var(--surface-active)]',
  hover: 'hover-hover:bg-[var(--surface-hover)]',
  nested: 'mt-0.5 ml-[3px] flex min-w-0 flex-col gap-0.5 border-[var(--border)] border-l pl-[9px]',
  iconButton: '!p-1.5 -m-1.5',
} as const

/**
 * Common badge styling for status badges
 */
export const BADGE_STYLE = 'rounded-sm px-1 py-[0px] text-xs'
