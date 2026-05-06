/**
 * Hook that connects the table undo/redo store to React Query mutations.
 */

import { useCallback, useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import {
  useAddTableColumn,
  useBatchCreateTableRows,
  useBatchUpdateTableRows,
  useCreateTableRow,
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
 * Extract the row ID from a create-row API response.
 */
export function extractCreatedRowId(response: Record<string, unknown>): string | undefined {
  const data = response?.data as Record<string, unknown> | undefined
  const row = data?.row as Record<string, unknown> | undefined
  return row?.id as string | undefined
}

interface UseTableUndoProps {
  workspaceId: string
  tableId: string
  onColumnOrderChange?: (order: string[]) => void
  onColumnRename?: (oldName: string, newName: string) => void
  onColumnWidthsChange?: (widths: Record<string, number>) => void
  getColumnWidths?: () => Record<string, number>
}

export function useTableUndo({
  workspaceId,
  tableId,
  onColumnOrderChange,
  onColumnRename,
  onColumnWidthsChange,
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
  const createRowMutation = useCreateTableRow({ workspaceId, tableId })
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
  const getColumnWidthsRef = useRef(getColumnWidths)
  getColumnWidthsRef.current = getColumnWidths

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
    (action: TableUndoAction, direction: 'undo' | 'redo') => {
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
            batchUpdateRowsMutation.mutate({ updates })
            break
          }

          case 'update-cells': {
            const updates = action.cells.map((cell) => ({
              rowId: cell.rowId,
              data: direction === 'undo' ? cell.oldData : cell.newData,
            }))
            batchUpdateRowsMutation.mutate({ updates })
            break
          }

          case 'create-row': {
            if (direction === 'undo') {
              deleteRowMutation.mutate(action.rowId)
            } else {
              createRowMutation.mutate(
                { data: action.data ?? {}, position: action.position },
                {
                  onSuccess: (response) => {
                    const newRowId = extractCreatedRowId(response as Record<string, unknown>)
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
                  positions: action.rows.map((r) => r.position),
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
                  positions: action.rows.map((row) => row.position),
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
            if (direction === 'undo') {
              deleteColumnMutation.mutate(action.columnName, {
                onSuccess: () => {
                  const currentWidths = getColumnWidthsRef.current?.() ?? {}
                  if (action.columnName in currentWidths) {
                    const { [action.columnName]: _, ...rest } = currentWidths
                    onColumnWidthsChangeRef.current?.(rest)
                    updateMetadataMutation.mutate({ columnWidths: rest })
                  }
                },
              })
            } else {
              addColumnMutation.mutate({
                name: action.columnName,
                type: 'string',
                position: action.position,
              })
            }
            break
          }

          case 'delete-column': {
            if (direction === 'undo') {
              addColumnMutation.mutate(
                {
                  name: action.columnName,
                  type: action.columnType,
                  required: action.columnRequired,
                  unique: action.columnUnique,
                  position: action.columnPosition,
                },
                {
                  onSuccess: () => {
                    if (action.cellData.length > 0) {
                      const updates = action.cellData.map((c) => ({
                        rowId: c.rowId,
                        data: { [action.columnName]: c.value },
                      }))
                      batchUpdateRowsMutation.mutate(
                        { updates },
                        {
                          onError: (error) => {
                            logger.error('Failed to restore cell data on delete-column undo', {
                              columnName: action.columnName,
                              error,
                            })
                          },
                        }
                      )
                    }
                    const metadata: Record<string, unknown> = {}
                    if (action.previousOrder) {
                      onColumnOrderChangeRef.current?.(action.previousOrder)
                      metadata.columnOrder = action.previousOrder
                    }
                    if (action.previousWidth !== null) {
                      const merged = {
                        ...(getColumnWidthsRef.current?.() ?? {}),
                        [action.columnName]: action.previousWidth,
                      }
                      metadata.columnWidths = merged
                      onColumnWidthsChangeRef.current?.(merged)
                    }
                    if (Object.keys(metadata).length > 0) {
                      updateMetadataMutation.mutate(metadata)
                    }
                  },
                }
              )
            } else {
              deleteColumnMutation.mutate(action.columnName, {
                onSuccess: () => {
                  const metadata: Record<string, unknown> = {}
                  if (action.previousOrder) {
                    const newOrder = action.previousOrder.filter((n) => n !== action.columnName)
                    onColumnOrderChangeRef.current?.(newOrder)
                    metadata.columnOrder = newOrder
                  }
                  if (action.previousWidth !== null) {
                    const currentWidths = getColumnWidthsRef.current?.() ?? {}
                    const { [action.columnName]: _, ...rest } = currentWidths
                    metadata.columnWidths = rest
                    onColumnWidthsChangeRef.current?.(rest)
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
            updateColumnMutation.mutate({
              columnName: fromName,
              updates: { name: toName },
            })
            onColumnRenameRef.current?.(fromName, toName)
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
            const order = direction === 'undo' ? action.previousOrder : action.newOrder
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
    const entry = popUndo(tableId)
    if (!entry) return

    runWithoutRecording(() => {
      executeAction(entry.action, 'undo')
    })
  }, [popUndo, tableId, executeAction])

  const redo = useCallback(() => {
    const entry = popRedo(tableId)
    if (!entry) return

    runWithoutRecording(() => {
      executeAction(entry.action, 'redo')
    })
  }, [popRedo, tableId, executeAction])

  return { pushUndo, undo, redo, canUndo, canRedo }
}
