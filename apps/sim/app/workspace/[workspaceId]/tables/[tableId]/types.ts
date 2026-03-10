import type { Filter, Sort, TableRow } from '@/lib/table'

/**
 * Reason the inline editor completed, used to determine navigation after save
 */
export type SaveReason = 'enter' | 'tab' | 'shift-tab' | 'blur'

/**
 * Query options for filtering and sorting table data
 */
export interface QueryOptions {
  filter: Filter | null
  sort: Sort | null
}

/**
 * State for the row context menu (right-click)
 */
export interface ContextMenuState {
  isOpen: boolean
  position: { x: number; y: number }
  row: TableRow | null
}

/**
 * Tracks which cell is currently being edited inline
 */
export interface EditingCell {
  rowId: string
  columnName: string
}
