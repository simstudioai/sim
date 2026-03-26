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
 * Sort field options for terminal entries
 */
export type SortField = 'timestamp'

/**
 * Sort direction options
 */
export type SortDirection = 'asc' | 'desc'

/**
 * Sort configuration for terminal entries
 */
export interface SortConfig {
  field: SortField
  direction: SortDirection
}

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
 * Common row styling classes for terminal components
 */
export const ROW_STYLES = {
  base: 'group flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2',
  selected: 'bg-[var(--surface-active)]',
  hover: 'hover:bg-[var(--surface-active)]',
  nested: 'mt-0.5 ml-[3px] flex min-w-0 flex-col gap-0.5 border-[var(--border)] border-l pl-[9px]',
  iconButton: '!p-1.5 -m-1.5',
} as const

/**
 * Common badge styling for status badges
 */
export const BADGE_STYLE = 'rounded-sm px-1 py-[0px] text-xs'
