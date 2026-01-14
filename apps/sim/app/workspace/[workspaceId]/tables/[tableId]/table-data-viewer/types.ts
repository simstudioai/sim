/**
 * Type definitions for the table data viewer.
 *
 * @module tables/[tableId]/table-data-viewer/types
 */

import type { TableSchema } from '@/lib/table'

/**
 * Represents row data stored in a table.
 */
export interface TableRowData {
  /** Unique identifier for the row */
  id: string
  /** Row field values keyed by column name */
  data: Record<string, unknown>
  /** ISO timestamp when the row was created */
  createdAt: string
  /** ISO timestamp when the row was last updated */
  updatedAt: string
}

/**
 * Represents table metadata.
 */
export interface TableData {
  /** Unique identifier for the table */
  id: string
  /** Table name */
  name: string
  /** Optional description */
  description?: string
  /** Schema defining columns */
  schema: TableSchema
  /** Current number of rows */
  rowCount: number
  /** Maximum allowed rows */
  maxRows: number
  /** ISO timestamp when created */
  createdAt: string
  /** ISO timestamp when last updated */
  updatedAt: string
}

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
  row: TableRowData | null
}
