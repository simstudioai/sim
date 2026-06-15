/**
 * Type definitions for table undo/redo actions.
 */

import type { ColumnDefinition } from '@/lib/table'

export interface DeletedRowSnapshot {
  rowId: string
  data: Record<string, unknown>
  position: number
  /** Fractional order key, when present — restore re-inserts at this exact key. */
  orderKey?: string
}

export type TableUndoAction =
  | {
      type: 'update-cell'
      rowId: string
      columnName: string
      previousValue: unknown
      newValue: unknown
    }
  | { type: 'clear-cells'; cells: Array<{ rowId: string; data: Record<string, unknown> }> }
  | {
      type: 'update-cells'
      cells: Array<{
        rowId: string
        oldData: Record<string, unknown>
        newData: Record<string, unknown>
      }>
    }
  | {
      type: 'create-row'
      rowId: string
      position: number
      orderKey?: string
      data?: Record<string, unknown>
    }
  | {
      type: 'create-rows'
      rows: Array<{
        rowId: string
        position: number
        orderKey?: string
        data: Record<string, unknown>
      }>
    }
  | { type: 'delete-rows'; rows: DeletedRowSnapshot[] }
  // `columnName` is the display name (for re-create); `columnId` is the stable
  // storage key used for the delete/update lookup and id-keyed metadata cleanup.
  | { type: 'create-column'; columnName: string; columnId?: string; position: number }
  | {
      type: 'delete-column'
      columnName: string
      columnId?: string
      columnType: ColumnDefinition['type']
      columnPosition: number
      columnUnique: boolean
      columnRequired: boolean
      /** Predefined options to restore on re-create (select columns). */
      columnOptions?: string[]
      cellData: Array<{ rowId: string; value: unknown }>
      previousOrder: string[] | null
      previousWidth: number | null
      previousPinnedColumns: string[] | null
    }
  // `oldName`/`newName` are display names; `columnId` is the stable lookup key.
  | { type: 'rename-column'; oldName: string; newName: string; columnId?: string }
  | {
      type: 'update-column-type'
      columnName: string
      previousType: ColumnDefinition['type']
      newType: ColumnDefinition['type']
      /** Options to restore when undoing back to a select column (the server
       *  strips them on the way out of select). */
      previousOptions?: string[]
      /** Options to re-apply when redoing a change to a select column. */
      newOptions?: string[]
    }
  | {
      type: 'toggle-column-constraint'
      columnName: string
      constraint: 'unique' | 'required'
      previousValue: boolean
      newValue: boolean
    }
  | { type: 'rename-table'; tableId: string; previousName: string; newName: string }
  | { type: 'reorder-columns'; previousOrder: string[]; newOrder: string[] }

export interface UndoEntry {
  id: string
  action: TableUndoAction
  timestamp: number
}

export interface TableUndoStacks {
  undo: UndoEntry[]
  redo: UndoEntry[]
}

export interface TableUndoState {
  stacks: Record<string, TableUndoStacks>
  push: (tableId: string, action: TableUndoAction) => void
  popUndo: (tableId: string) => UndoEntry | null
  popRedo: (tableId: string) => UndoEntry | null
  patchRedoRowId: (tableId: string, oldRowId: string, newRowId: string) => void
  patchUndoRowId: (tableId: string, oldRowId: string, newRowId: string) => void
  clear: (tableId: string) => void
}
