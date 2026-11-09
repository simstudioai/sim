/**
 * Terminal filter configuration state
 */
export interface TerminalFilters {
  blockIds: Set<string>
  statuses: Set<'error' | 'info'>
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
