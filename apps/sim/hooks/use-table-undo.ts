import { useCallback, useEffect, useRef } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { TABLE_LIMITS } from '@/lib/table/constants'
import {
  TABLE_LOCK_FLAGS,
  type TableLockKind,
  type TableLocks,
  type TableMetadata,
} from '@/lib/table/types'
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
function undoActionVerbs(action: TableUndoAction, direction: 'undo' | 'redo'): TableLockKind[] {
  const undoing = direction === 'undo'
  switch (action.type) {
    case 'update-cell':
    case 'update-cells':
    case 'clear-cells':
      return ['update']
    case 'create-row':
    case 'create-rows':
      return undoing ? ['delete'] : ['insert']
    case 'delete-rows':
      return undoing ? ['insert'] : ['delete']
    // Dropping or retyping a column clears its value from every row, so those
    // directions need the delete lock clear too — mirroring
    // `assertColumnDestructive`. Undoing a delete-column re-adds the column and
    // writes the saved cells back, which is a row update.
    case 'create-column':
      return undoing ? ['schema', 'delete'] : ['schema']
    case 'delete-column':
      return undoing ? ['schema', 'update'] : ['schema', 'delete']
    case 'update-column-type':
      return ['schema', 'delete']
    case 'rename-column':
    case 'toggle-column-constraint':
      return ['schema']
    default:
      return []
  }
}

/** The first lock (if any) that would block replaying `action` in `direction`. */
function undoActionBlockedBy(
  action: TableUndoAction,
  direction: 'undo' | 'redo',
  locks: TableLocks | undefined
): TableLockKind | null {
  if (!locks) return null
  return undoActionVerbs(action, direction).find((kind) => locks[TABLE_LOCK_FLAGS[kind]]) ?? null
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
  /**
   * Sink for column-layout writes (order, widths, pinning). Defaults to the
   * table's shared metadata; with a saved view active the caller passes the
   * view's sink instead, so undoing a reorder unwinds it where the original
   * reorder was stored rather than silently rewriting the "All" layout.
   */
  onPersistLayout?: (patch: TableMetadata) => void
  /**
   * Active view id (`null` for "All" or when views are disabled). Layout is
   * view-owned, so recorded layout actions are stamped with it and dropped when
   * the user switches away — otherwise an undo would write the outgoing view's
   * column order into whichever view happens to be active at the time.
   */
  activeViewId?: string | null
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
  onPersistLayout,
  activeViewId = null,
}: UseTableUndoProps) {
  const push = useTableUndoStore((s) => s.push)
  const popUndo = useTableUndoStore((s) => s.popUndo)
  const popRedo = useTableUndoStore((s) => s.popRedo)
  const patchRedoRowId = useTableUndoStore((s) => s.patchRedoRowId)
  const patchUndoRowId = useTableUndoStore((s) => s.patchUndoRowId)
  const clear = useTableUndoStore((s) => s.clear)
  const pruneLayoutActions = useTableUndoStore((s) => s.pruneLayoutActions)
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

  const persistLayoutRef = useRef(onPersistLayout ?? updateMetadataMutation.mutate)
  persistLayoutRef.current = onPersistLayout ?? updateMetadataMutation.mutate

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
  const activeViewIdRef = useRef(activeViewId)
  activeViewIdRef.current = activeViewId

  useEffect(() => {
    return () => clear(tableId)
  }, [clear, tableId])

  useEffect(() => {
    pruneLayoutActions(tableId, activeViewId)
  }, [pruneLayoutActions, tableId, activeViewId])

  const pushUndo = useCallback(
    /**
     * `owner` overrides the recorded view for actions pushed from a mutation
     * callback — by then the active view may have changed, and stamping the
     * destination would let a later undo apply the origin's layout to it.
     */
    (action: TableUndoAction, owner?: string | null) => {
      push(tableId, action, owner === undefined ? activeViewIdRef.current : owner)
    },
    [push, tableId]
  )

  const executeAction = useCallback(
    async (action: TableUndoAction, direction: 'undo' | 'redo', entryViewId: string | null) => {
      // Column create/delete are table-scoped, so they stay undoable after a view
      // switch — but the layout they recorded belongs to the view that was active
      // at the time. Replaying it elsewhere would write one view's order/widths
      // into another, so the schema half runs and the layout half is dropped.
      //
      // Evaluated at CALL time, not here: these writes happen in mutation success
      // callbacks, and `persistLayoutRef` is rebound on every render. A guard
      // resolved up front would still hold from before a switch while the sink it
      // guards already pointed at the destination view.
      const entryOwnsLayout = () => entryViewId === activeViewIdRef.current
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
                  // Everything below is layout cleanup for the recorded view. In
                  // any other view the grid shows that view's own layout — the
                  // schema change has already landed and dangling width/pin keys
                  // are pruned on read, so touching the screen OR persisting here
                  // would push the origin view's layout onto the one on display.
                  if (!entryOwnsLayout()) return
                  const metadata: TableMetadata = {}
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
                  if (Object.keys(metadata).length > 0) persistLayoutRef.current(metadata)
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
                    // Cell restore above runs everywhere — it's row data. The
                    // layout below belongs to the recorded view: elsewhere the
                    // restored column still reappears via the grid's append
                    // effect, but at the end, leaving the on-screen layout alone.
                    if (!entryOwnsLayout()) return
                    const metadata: TableMetadata = {}
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
                    if (Object.keys(metadata).length > 0) persistLayoutRef.current(metadata)
                  },
                }
              )
            } else {
              deleteColumnMutation.mutate(colKey, {
                onSuccess: () => {
                  if (!entryOwnsLayout()) return
                  const metadata: TableMetadata = {}
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
                  if (Object.keys(metadata).length > 0) persistLayoutRef.current(metadata)
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
            // Pruning already drops these on a view switch, so a mismatch here
            // should be unreachable; the guard keeps the invariant local rather
            // than dependent on when the prune effect happens to run.
            if (!entryOwnsLayout()) break
            onColumnOrderChangeRef.current?.(order)
            persistLayoutRef.current({ columnOrder: order })
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
    void runWithoutRecording(() => executeAction(entry.action, 'undo', entry.viewId))
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
    void runWithoutRecording(() => executeAction(entry.action, 'redo', entry.viewId))
  }, [popRedo, tableId, executeAction])

  return { pushUndo, undo, redo, canUndo, canRedo }
}
