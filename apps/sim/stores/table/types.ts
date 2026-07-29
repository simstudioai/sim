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
      orderKey?: string
      data?: Record<string, unknown>
    }
  | {
      type: 'create-rows'
      rows: Array<{
        rowId: string
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
      // A `select` column is invalid without its option set, so the snapshot has
      // to carry it or the restore is rejected — and the saved cell data, which
      // holds option ids, would have nothing to attach to.
      columnOptions?: ColumnDefinition['options']
      columnMultiple?: boolean
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
  /**
   * Active view when the action was recorded — `null` for "All" or when views
   * are disabled. Layout is view-owned, so a layout action is only meaningful
   * against the view that owned it; see {@link VIEW_SCOPED_UNDO_ACTIONS}.
   */
  viewId: string | null
}

/**
 * Action types that do NOTHING but rearrange columns, so they mean nothing
 * outside the view that recorded them and are dropped on a view switch.
 *
 * Deliberately excludes `create-column`/`delete-column`: those are table-scoped
 * schema operations that merely have a layout side-effect, so they stay
 * undoable everywhere. Their layout half is suppressed at replay time instead —
 * see `entryOwnsLayout` in `use-table-undo`.
 */
export const VIEW_SCOPED_UNDO_ACTIONS = new Set<TableUndoAction['type']>(['reorder-columns'])

export interface TableUndoStacks {
  undo: UndoEntry[]
  redo: UndoEntry[]
}

export interface TableUndoState {
  stacks: Record<string, TableUndoStacks>
  push: (tableId: string, action: TableUndoAction, viewId: string | null) => void
  popUndo: (tableId: string) => UndoEntry | null
  popRedo: (tableId: string) => UndoEntry | null
  patchRedoRowId: (tableId: string, oldRowId: string, newRowId: string) => void
  patchUndoRowId: (tableId: string, oldRowId: string, newRowId: string) => void
  clear: (tableId: string) => void
  /**
   * Drops purely-layout actions recorded under a different view. Called on every
   * view switch so undo can never write one view's layout into another.
   */
  pruneLayoutActions: (tableId: string, viewId: string | null) => void
}
