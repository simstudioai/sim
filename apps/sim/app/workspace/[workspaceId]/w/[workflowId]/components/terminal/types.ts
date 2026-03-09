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
  base: 'group flex cursor-pointer items-center justify-between gap-[8px] rounded-[8px] px-[6px]',
  selected: 'bg-[var(--surface-6)] dark:bg-[var(--surface-5)]',
  hover: 'hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]',
  nested:
    'mt-[2px] ml-[3px] flex min-w-0 flex-col gap-[2px] border-[var(--border)] border-l pl-[9px]',
  iconButton: '!p-1.5 -m-1.5',
} as const

/**
 * Common badge styling for status badges
 */
export const BADGE_STYLE = 'rounded-[4px] px-[4px] py-[0px] text-[11px]'
