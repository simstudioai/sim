/**
 * Type definitions for the table data viewer.
 *
 * @module tables/[tableId]/table-data-viewer/types
 */

import type { TableRow } from '@/lib/table'

/**
 * Data for the cell viewer modal.
 */
export interface CellViewerData {
  /** Name of the column being viewed */
  columnName: string
  /** Value being displayed */
  value: unknown
  /** Display type for formatting */
  type: 'json' | 'text' | 'date'
}

/**
 * State for the right-click context menu.
 */
export interface ContextMenuState {
  /** Whether the menu is visible */
  isOpen: boolean
  /** Screen position of the menu */
  position: { x: number; y: number }
  /** Row the menu was opened on */
  row: TableRow | null
}
