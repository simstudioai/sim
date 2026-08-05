import type { SortSpec, TablePredicate, TableRow } from '@/lib/table'

/**
 * Query options for filtering and sorting table data
 */
export interface QueryOptions {
  filter: TablePredicate | null
  sort: SortSpec | null
}

/**
 * State for the row context menu (right-click).
 * When `row` is null and `rowIndex` is set, the menu targets an empty cell.
 */
export interface ContextMenuState {
  isOpen: boolean
  position: { x: number; y: number }
  row: TableRow | null
  rowIndex: number | null
  columnName: string | null
}
