import { chipContentGap, chipContentLabelClass, chipVariants, cn } from '@sim/emcn'

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
 * A log row IS a chip — it renders `chipVariants` rather than restating it, so
 * geometry, hover and selected follow the pill automatically. `justify-between`
 * is the only delta: a log row pushes its duration to the far edge.
 */
export const ROW_STYLES = {
  row: cn(chipVariants({ fullWidth: true }), 'justify-between'),
  rowSelected: cn(chipVariants({ fullWidth: true, active: true }), 'justify-between'),
  content: `flex min-w-0 flex-1 items-center ${chipContentGap}`,
  label: chipContentLabelClass,
  labelError: cn(chipContentLabelClass, 'text-[var(--text-error)]'),
  status: 'flex-shrink-0 text-sm',
  statusIdle: 'text-[var(--text-muted)]',
  nested: 'mt-0.5 ml-[3px] flex min-w-0 flex-col gap-0.5 border-[var(--border)] border-l pl-[9px]',
  iconButton: '!p-1.5 -m-1.5',
} as const

/**
 * Common badge styling for status badges
 */
export const BADGE_STYLE = 'rounded-sm px-1 py-[0px] text-xs'
