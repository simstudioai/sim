import type { Filter, Sort, TableRow } from '@/lib/table'

/**
 * Query options for filtering and sorting table data
 */
export interface QueryOptions {
  filter: Filter | null
  sort: Sort | null
}

/**
 * Data for viewing a cell's full content in a modal
 */
export interface CellViewerData {
  columnName: string
  value: unknown
  type: 'json' | 'text' | 'date' | 'boolean' | 'number'
}

/**
 * State for the row context menu (right-click)
 */
export interface ContextMenuState {
  isOpen: boolean
  position: { x: number; y: number }
  row: TableRow | null
}
