/**
 * Type definitions for table undo/redo actions.
 */

export interface DeletedRowSnapshot {
  rowId: string
  data: Record<string, unknown>
  position: number
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
  | { type: 'create-row'; rowId: string; position: number; data?: Record<string, unknown> }
  | {
      type: 'create-rows'
      rows: Array<{ rowId: string; position: number; data: Record<string, unknown> }>
    }
  | { type: 'delete-rows'; rows: DeletedRowSnapshot[] }
  | { type: 'create-column'; columnName: string; position: number }
  | {
      type: 'delete-column'
      columnName: string
      columnType: string
      columnPosition: number
      columnUnique: boolean
      columnRequired: boolean
      cellData: Array<{ rowId: string; value: unknown }>
      previousOrder: string[] | null
      previousWidth: number | null
    }
  | { type: 'rename-column'; oldName: string; newName: string }
  | { type: 'update-column-type'; columnName: string; previousType: string; newType: string }
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
