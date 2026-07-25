import { useCallback, useEffect, useRef } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { TABLE_LIMITS } from '@/lib/table/constants'
import type { TableLockKind, TableLocks } from '@/lib/table/types'
import {
  useAddTableColumn,
  useBatchCreateTableRows,
  useBatchUpdateTableRows,
  useDeleteColumn,
  useDeleteTableRow,
  useDeleteTableRows,
  useRenameTable,
  useUpdateColumn,
  useUpdateTableMetadata,
  useUpdateTableRow,
} from '@/hooks/queries/tables'
import { runWithoutRecording, useTableUndoStore } from '@/stores/table/store'
import type { TableUndoAction } from '@/stores/table/types'

const logger = createLogger('useTableUndo')

/**
 * The mutation verb an undo/redo of `action` would perform in `direction`. Undo
 * inverts row create/delete (undoing a create deletes; undoing a delete
 * re-inserts), so the verb depends on direction. Column ops are always `schema`;
 * rename/reorder touch no locked verb (`null`).
 */
function undoActionVerb(action: TableUndoAction, direction: 'undo' | 'redo'): TableLockKind | null {
  switch (action.type) {
    case 'update-cell':
    case 'update-cells':
    case 'clear-cells':
      return 'update'
    case 'create-row':
    case 'create-rows':
      return direction === 'undo' ? 'delete' : 'insert'
    case 'delete-rows':
      return direction === 'undo' ? 'insert' : 'delete'
    case 'create-column':
    case 'delete-column':
    case 'rename-column':
    case 'update-column-type':
    case 'toggle-column-constraint':
      return 'schema'
    default:
      return null
  }
}

/** The lock (if any) that would block replaying `action` in `direction`. */
function undoActionBlockedBy(
  action: TableUndoAction,
  direction: 'undo' | 'redo',
  locks: TableLocks | undefined
): TableLockKind | null {
  if (!locks) return null
  switch (undoActionVerb(action, direction)) {
    case 'insert':
      return locks.insertLocked ? 'insert' : null
    case 'update':
      return locks.updateLocked ? 'update' : null
    case 'delete':
      return locks.deleteLocked ? 'delete' : null
    case 'schema':
      return locks.schemaLocked ? 'schema' : null
    default:
      return null
  }
}

const BLOCKED_UNDO_MESSAGE: Record<TableLockKind, string> = {
  insert: 'This table is insert-locked — that step cannot be undone.',
  update: 'This table is update-locked — that step cannot be undone.',
  delete: 'This table is delete-locked — that step cannot be undone.',
  schema: 'This table is schema-locked — that step cannot be undone.',
}

/**
 * Top of a stack without popping, so a lock-blocked step can be left in place
 * rather than popped-and-lost — see `undo`/`redo`.
 */
function peekAction(tableId: string, stack: 'undo' | 'redo'): TableUndoAction | undefined {
  return useTableUndoStore.getState().stacks[tableId]?.[stack].at(-1)?.action
}

export function extractCreatedRowId(response: Record<string, unknown>): string | undefined {
  const data = response?.data as Record<string, unknown> | undefined
  const row = data?.row as Record<string, unknown> | undefined
  return row?.id as string | undefined
}

interface UseTableUndoProps {
  workspaceId: string
  tableId: string
  /** Current table locks, so undo/redo skips a step whose verb is locked. */
  getLocks?: () => TableLocks | undefined
  onColumnOrderChange?: (order: string[]) => void
  onColumnRename?: (oldName: string, newName: string) => void
  onColumnWidthsChange?: (widths: Record<string, number>) => void
  onPinnedColumnsChange?: (pinned: string[]) => void
  getPinnedColumns?: () => string[]
  getColumnWidths?: () => Record<string, number>
}

export function useTableUndo({
  workspaceId,
  tableId,
  getLocks,
  onColumnOrderChange,
  onColumnRename,
  onColumnWidthsChange,
  onPinnedColumnsChange,
  getPinnedColumns,
  getColumnWidths,
}: UseTableUndoProps) {
  const push = useTableUndoStore((s) => s.push)
  const popUndo = useTableUndoStore((s) => s.popUndo)
  const popRedo = useTableUndoStore((s) => s.popRedo)
  const patchRedoRowId = useTableUndoStore((s) => s.patchRedoRowId)
  const patchUndoRowId = useTableUndoStore((s) => s.patchUndoRowId)
  const clear = useTableUndoStore((s) => s.clear)
  const canUndo = useTableUndoStore((s) => (s.stacks[tableId]?.undo.length ?? 0) > 0)
  const canRedo = useTableUndoStore((s) => (s.stacks[tableId]?.redo.length ?? 0) > 0)

  const updateRowMutation = useUpdateTableRow({ workspaceId, tableId })
  const batchCreateRowsMutation = useBatchCreateTableRows({ workspaceId, tableId })
  const batchUpdateRowsMutation = useBatchUpdateTableRows({ workspaceId, tableId })
  const deleteRowMutation = useDeleteTableRow({ workspaceId, tableId })
  const deleteRowsMutation = useDeleteTableRows({ workspaceId, tableId })
  const addColumnMutation = useAddTableColumn({ workspaceId, tableId })
  const updateColumnMutation = useUpdateColumn({ workspaceId, tableId })
  const deleteColumnMutation = useDeleteColumn({ workspaceId, tableId })
  const renameTableMutation = useRenameTable(workspaceId)
  const updateMetadataMutation = useUpdateTableMetadata({ workspaceId, tableId })

  const onColumnOrderChangeRef = useRef(onColumnOrderChange)
  onColumnOrderChangeRef.current = onColumnOrderChange
  const onColumnRenameRef = useRef(onColumnRename)
  onColumnRenameRef.current = onColumnRename
  const onColumnWidthsChangeRef = useRef(onColumnWidthsChange)
  onColumnWidthsChangeRef.current = onColumnWidthsChange
  const onPinnedColumnsChangeRef = useRef(onPinnedColumnsChange)
  onPinnedColumnsChangeRef.current = onPinnedColumnsChange
  const getPinnedColumnsRef = useRef(getPinnedColumns)
  getPinnedColumnsRef.current = getPinnedColumns
  const getColumnWidthsRef = useRef(getColumnWidths)
  getColumnWidthsRef.current = getColumnWidths
  const getLocksRef = useRef(getLocks)
  getLocksRef.current = getLocks

  useEffect(() => {
    return () => clear(tableId)
  }, [clear, tableId])

  const pushUndo = useCallback(
    (action: TableUndoAction) => {
      push(tableId, action)
    },
    [push, tableId]
  )

  const executeAction = useCallback(
    async (action: TableUndoAction, direction: 'undo' | 'redo') => {
      try {
        switch (action.type) {
          case 'update-cell': {
            const value = direction === 'undo' ? action.previousValue : action.newValue
            updateRowMutation.mutate({
              rowId: action.rowId,
              data: { [action.columnName]: value },
            })
            break
          }

          case 'clear-cells': {
            const updates = action.cells.map((cell) => ({
              rowId: cell.rowId,
              data:
                direction === 'undo'
                  ? cell.data
                  : Object.fromEntries(Object.keys(cell.data).map((k) => [k, null])),
            }))
            for (let i = 0; i < updates.length; i += TABLE_LIMITS.MAX_BULK_OPERATION_SIZE) {
              await batchUpdateRowsMutation.mutateAsync({
                updates: updates.slice(i, i + TABLE_LIMITS.MAX_BULK_OPERATION_SIZE),
              })
            }
            break
          }

          case 'update-cells': {
            const updates = action.cells.map((cell) => ({
              rowId: cell.rowId,
              data: direction === 'undo' ? cell.oldData : cell.newData,
            }))
            for (let i = 0; i < updates.length; i += TABLE_LIMITS.MAX_BULK_OPERATION_SIZE) {
              await batchUpdateRowsMutation.mutateAsync({
                updates: updates.slice(i, i + TABLE_LIMITS.MAX_BULK_OPERATION_SIZE),
              })
            }
            break
          }

          case 'create-row': {
            if (direction === 'undo') {
              deleteRowMutation.mutate(action.rowId)
            } else {
              // Redo via the batch path so the saved orderKey restores exact placement.
              // The single-insert API has no orderKey field, and order_key is authoritative —
              // a gappy saved position would misplace the row.
              batchCreateRowsMutation.mutate(
                {
                  rows: [action.data ?? {}],
                  orderKeys: action.orderKey ? [action.orderKey] : undefined,
                },
                {
                  onSuccess: (response) => {
                    const newRowId = response?.data?.rows?.[0]?.id
                    if (newRowId && newRowId !== action.rowId) {
                      patchUndoRowId(tableId, action.rowId, newRowId)
                    }
                  },
                }
              )
            }
            break
          }

          case 'create-rows': {
            if (direction === 'undo') {
              const rowIds = action.rows.map((r) => r.rowId)
              if (rowIds.length === 1) {
                deleteRowMutation.mutate(rowIds[0])
              } else {
                deleteRowsMutation.mutate(rowIds)
              }
            } else {
              batchCreateRowsMutation.mutate(
                {
                  rows: action.rows.map((r) => r.data),
                  orderKeys: action.rows.every((r) => r.orderKey)
                    ? action.rows.map((r) => r.orderKey as string)
                    : undefined,
                },
                {
                  onSuccess: (response) => {
                    const createdRows = response?.data?.rows ?? []
                    for (let i = 0; i < createdRows.length && i < action.rows.length; i++) {
                      if (createdRows[i].id && createdRows[i].id !== action.rows[i].rowId) {
                        patchUndoRowId(tableId, action.rows[i].rowId, createdRows[i].id)
                      }
                    }
                  },
                }
              )
            }
            break
          }

          case 'delete-rows': {
            if (direction === 'undo') {
              batchCreateRowsMutation.mutate(
                {
                  rows: action.rows.map((row) => row.data),
                  orderKeys: action.rows.every((row) => row.orderKey)
                    ? action.rows.map((row) => row.orderKey as string)
                    : undefined,
                },
                {
                  onSuccess: (response) => {
                    const createdRows = response?.data?.rows ?? []
                    for (let i = 0; i < createdRows.length && i < action.rows.length; i++) {
                      if (createdRows[i].id) {
                        patchRedoRowId(tableId, action.rows[i].rowId, createdRows[i].id)
                      }
                    }
                  },
                }
              )
            } else {
              const rowIds = action.rows.map((r) => r.rowId)
              if (rowIds.length === 1) {
                deleteRowMutation.mutate(rowIds[0])
              } else {
                deleteRowsMutation.mutate(rowIds)
              }
            }
            break
          }

          case 'create-column': {
            // Identity (delete lookup + id-keyed metadata) uses the stable id;
            // re-create uses the display name.
            const colKey = action.columnId ?? action.columnName
            if (direction === 'undo') {
              deleteColumnMutation.mutate(colKey, {
                onSuccess: () => {
                  const metadata: Record<string, unknown> = {}
                  const currentWidths = getColumnWidthsRef.current?.() ?? {}
                  if (colKey in currentWidths) {
                    const { [colKey]: _, ...rest } = currentWidths
                    onColumnWidthsChangeRef.current?.(rest)
                    metadata.columnWidths = rest
                  }
                  const currentPinned = getPinnedColumnsRef.current?.() ?? []
                  if (currentPinned.includes(colKey)) {
                    const newPinned = currentPinned.filter((n) => n !== colKey)
                    onPinnedColumnsChangeRef.current?.(newPinned)
                    metadata.pinnedColumns = newPinned
                  }
                  if (Object.keys(metadata).length > 0) {
                    updateMetadataMutation.mutate(metadata)
                  }
                },
              })
            } else {
              addColumnMutation.mutate({
                ...(action.columnId ? { id: action.columnId } : {}),
                name: action.columnName,
                type: 'string',
                position: action.position,
              })
            }
            break
          }

          case 'delete-column': {
            // Identity (cell-data keys, id-keyed metadata, delete lookup) uses the
            // stable id; re-create uses the display name.
            const colKey = action.columnId ?? action.columnName
            if (direction === 'undo') {
              addColumnMutation.mutate(
                {
                  // Reuse the original id so the saved (id-keyed) cell data below
                  // lands on the restored column.
                  ...(action.columnId ? { id: action.columnId } : {}),
                  name: action.columnName,
                  type: action.columnType,
                  required: action.columnRequired,
                  unique: action.columnUnique,
                  // A select column is rejected without its options, and the
                  // cell data restored below is keyed by those option ids.
                  ...(action.columnOptions ? { options: action.columnOptions } : {}),
                  ...(action.columnMultiple ? { multiple: true } : {}),
                  position: action.columnPosition,
                },
                {
                  onSuccess: () => {
                    if (action.cellData.length > 0) {
                      const updates = action.cellData.map((c) => ({
                        rowId: c.rowId,
                        data: { [colKey]: c.value },
                      }))
                      void (async () => {
                        try {
                          for (
                            let i = 0;
                            i < updates.length;
                            i += TABLE_LIMITS.MAX_BULK_OPERATION_SIZE
                          ) {
                            await batchUpdateRowsMutation.mutateAsync({
                              updates: updates.slice(i, i + TABLE_LIMITS.MAX_BULK_OPERATION_SIZE),
                            })
                          }
                        } catch (error) {
                          logger.error('Failed to restore cell data on delete-column undo', {
                            columnName: action.columnName,
                            error,
                          })
                        }
                      })()
                    }
                    const metadata: Record<string, unknown> = {}
                    if (action.previousOrder) {
                      onColumnOrderChangeRef.current?.(action.previousOrder)
                      metadata.columnOrder = action.previousOrder
                    }
                    if (action.previousWidth !== null) {
                      const merged = {
                        ...(getColumnWidthsRef.current?.() ?? {}),
                        [colKey]: action.previousWidth,
                      }
                      metadata.columnWidths = merged
                      onColumnWidthsChangeRef.current?.(merged)
                    }
                    if (action.previousPinnedColumns !== null) {
                      const wasColumnPinned = action.previousPinnedColumns.includes(colKey)
                      if (wasColumnPinned) {
                        const currentPinned = getPinnedColumnsRef.current?.() ?? []
                        if (!currentPinned.includes(colKey)) {
                          const insertIndex = action.previousPinnedColumns.indexOf(colKey)
                          const restoredPinned = [...currentPinned]
                          restoredPinned.splice(
                            Math.min(insertIndex, restoredPinned.length),
                            0,
                            colKey
                          )
                          onPinnedColumnsChangeRef.current?.(restoredPinned)
                          metadata.pinnedColumns = restoredPinned
                        }
                      }
                    }
                    if (Object.keys(metadata).length > 0) {
                      updateMetadataMutation.mutate(metadata)
                    }
                  },
                }
              )
            } else {
              deleteColumnMutation.mutate(colKey, {
                onSuccess: () => {
                  const metadata: Record<string, unknown> = {}
                  if (action.previousOrder) {
                    const newOrder = action.previousOrder.filter((n) => n !== colKey)
                    onColumnOrderChangeRef.current?.(newOrder)
                    metadata.columnOrder = newOrder
                  }
                  if (action.previousWidth !== null) {
                    const currentWidths = getColumnWidthsRef.current?.() ?? {}
                    const { [colKey]: _, ...rest } = currentWidths
                    metadata.columnWidths = rest
                    onColumnWidthsChangeRef.current?.(rest)
                  }
                  if (action.previousPinnedColumns !== null) {
                    const currentPinned = getPinnedColumnsRef.current?.() ?? []
                    if (currentPinned.includes(colKey)) {
                      const newPinned = currentPinned.filter((n) => n !== colKey)
                      onPinnedColumnsChangeRef.current?.(newPinned)
                      metadata.pinnedColumns = newPinned
                    }
                  }
                  if (Object.keys(metadata).length > 0) {
                    updateMetadataMutation.mutate(metadata)
                  }
                },
              })
            }
            break
          }

          case 'rename-column': {
            const fromName = direction === 'undo' ? action.newName : action.oldName
            const toName = direction === 'undo' ? action.oldName : action.newName
            // Look up by the stable id (falls back to the current name) so undo
            // never renames the column to its internal id.
            const colKey = action.columnId ?? fromName
            updateColumnMutation.mutate({
              columnName: colKey,
              updates: { name: toName },
            })
            onColumnRenameRef.current?.(colKey, toName)
            break
          }

          case 'update-column-type': {
            const type = direction === 'undo' ? action.previousType : action.newType
            updateColumnMutation.mutate({
              columnName: action.columnName,
              updates: { type },
            })
            break
          }

          case 'toggle-column-constraint': {
            const value = direction === 'undo' ? action.previousValue : action.newValue
            updateColumnMutation.mutate({
              columnName: action.columnName,
              updates: { [action.constraint]: value },
            })
            break
          }

          case 'rename-table': {
            const name = direction === 'undo' ? action.previousName : action.newName
            renameTableMutation.mutate({ tableId: action.tableId, name })
            break
          }

          case 'reorder-columns': {
            const restored = direction === 'undo' ? action.previousOrder : action.newOrder
            // The user may have pinned/unpinned since the original reorder;
            // restoring the raw snapshot can leave a currently-pinned column
            // in the middle, which breaks the sticky-offset walk in
            // pinnedOffsets and causes the column to jump over its left
            // neighbors on scroll.
            const pinned = getPinnedColumnsRef.current?.() ?? []
            let order = restored
            if (pinned.length > 0) {
              const pinnedSet = new Set(pinned)
              order = [
                ...restored.filter((n) => pinnedSet.has(n)),
                ...restored.filter((n) => !pinnedSet.has(n)),
              ]
            }
            onColumnOrderChangeRef.current?.(order)
            updateMetadataMutation.mutate({ columnOrder: order })
            break
          }
        }
      } catch (err) {
        logger.error('Failed to execute undo/redo action', { action, direction, err })
      }
    },
    [tableId, patchRedoRowId, patchUndoRowId]
  )

  const undo = useCallback(() => {
    // Check the lock BEFORE popping — a blocked step must stay on the stack, not
    // be silently discarded (the mutation would 423 and the entry would be lost).
    const next = peekAction(tableId, 'undo')
    if (next) {
      const blocked = undoActionBlockedBy(next, 'undo', getLocksRef.current?.())
      if (blocked) {
        toast.error(BLOCKED_UNDO_MESSAGE[blocked], { duration: 5000 })
        return
      }
    }
    const entry = popUndo(tableId)
    if (!entry) return
    void runWithoutRecording(() => executeAction(entry.action, 'undo'))
  }, [popUndo, tableId, executeAction])

  const redo = useCallback(() => {
    const next = peekAction(tableId, 'redo')
    if (next) {
      const blocked = undoActionBlockedBy(next, 'redo', getLocksRef.current?.())
      if (blocked) {
        toast.error(BLOCKED_UNDO_MESSAGE[blocked], { duration: 5000 })
        return
      }
    }
    const entry = popRedo(tableId)
    if (!entry) return
    void runWithoutRecording(() => executeAction(entry.action, 'redo'))
  }, [popRedo, tableId, executeAction])

  return { pushUndo, undo, redo, canUndo, canRedo }
}
