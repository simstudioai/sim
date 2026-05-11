'use client'

import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { Skeleton, toast } from '@/components/emcn'
import { TableX } from '@/components/emcn/icons'
import type { RunMode } from '@/lib/api/contracts/tables'
import { cn } from '@/lib/core/utils/cn'
import { captureEvent } from '@/lib/posthog/client'
import type { ColumnDefinition, TableRow as TableRowType } from '@/lib/table'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { isExecInFlight } from '@/lib/table/deps'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  useAddTableColumn,
  useBatchCreateTableRows,
  useBatchUpdateTableRows,
  useCreateTableRow,
  useDeleteColumn,
  useDeleteWorkflowGroup,
  useUpdateColumn,
  useUpdateTableMetadata,
  useUpdateTableRow,
  useUpdateWorkflowGroup,
} from '@/hooks/queries/tables'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { extractCreatedRowId, useTableUndo } from '@/hooks/use-table-undo'
import type { DeletedRowSnapshot } from '@/stores/table/types'
import { useContextMenu, useTable } from '../../hooks'
import type { EditingCell, QueryOptions, SaveReason } from '../../types'
import {
  cleanCellValue,
  generateColumnName as sharedGenerateColumnName,
  storageToDisplay,
} from '../../utils'
import type { ColumnConfig } from '../column-config-sidebar'
import { ContextMenu } from '../context-menu'
import { NewColumnDropdown } from '../new-column-dropdown'
import { RunStatusControl } from '../run-status-control'
import type { WorkflowConfig } from '../workflow-sidebar'
import { ExpandedCellPopover } from './cells'
import { ADD_COL_WIDTH, CELL_HEADER_CHECKBOX, COL_WIDTH, SELECTION_TINT_BG } from './constants'
import { DataRow } from './data-row'
import { ColumnHeaderMenu, WorkflowGroupMetaCell } from './headers'
import {
  AddRowButton,
  SelectAllCheckbox,
  TableBodySkeleton,
  TableColGroup,
} from './table-primitives'
import type { DisplayColumn } from './types'
import {
  buildHeaderGroups,
  type CellCoord,
  checkboxColLayout,
  classifyExecStatusMix,
  collectRowSnapshots,
  computeNormalizedSelection,
  type ExecStatusMix,
  expandToDisplayColumns,
  moveCell,
  ROW_SELECTION_ALL,
  ROW_SELECTION_NONE,
  type RowSelection,
  rowSelectionCoversAll,
  rowSelectionIncludes,
  rowSelectionIsEmpty,
  rowSelectionMaterialize,
} from './utils'

const logger = createLogger('TableView')

const COL_WIDTH_MIN = 80
const COL_WIDTH_AUTO_FIT_MAX = 1000
const SKELETON_COL_COUNT = 4
const ROW_HEIGHT_ESTIMATE = 35

const CELL_HEADER =
  'border-[var(--border)] border-r border-b bg-[var(--bg)] px-2 py-[7px] text-left align-middle'

/**
 * Snapshot of grid selection state the wrapper needs to render `<TableActionBar>`.
 * Fired from a `useEffect` so the callback identity doesn't drive re-renders.
 */
export interface SelectionSnapshot {
  /** Row ids in the action-bar selection (checkbox-row union with multi-row range). */
  actionBarRowIds: string[]
  /** Total running/queued workflow runs across `actionBarRowIds`. */
  runningInActionBarSelection: number
  /** Total running/queued workflow runs across ALL rows. Drives the page-header
   *  RunStatusControl ("N running, Stop all"). */
  totalRunning: number
  /** Whether the table has any workflow-output columns (drives the Run/Stop visibility). */
  hasWorkflowColumns: boolean
  /** Cells the Play / Refresh / Stop buttons act on. Null when the selection
   *  contains no workflow output cells. */
  selectedRunScope: { groupIds: string[]; rowIds: string[]; allRows: boolean } | null
  /** Drives Play (`hasIncompleteOrFailed`) / Refresh (`hasCompleted`) /
   *  Stop (`hasInFlight`) visibility on the action bar. */
  selectionStats: ExecStatusMix
  /**
   * When the highlight resolves to exactly one workflow-group execution —
   * same row, every highlighted column in the same workflow group — describe
   * it so the action bar can offer "View execution". Covers both the 1×1
   * single-cell case and 1 row × N cols highlights within one group. `null`
   * for multi-row, cross-group, or plain-column selections.
   */
  singleWorkflowCell: {
    rowId: string
    groupId: string
    executionId: string | null
    /** True iff the exec is in a state that produced a server log
     *  (completed / error / running). Drives the View execution button. */
    canViewExecution: boolean
  } | null
}

interface TableGridProps {
  workspaceId?: string
  tableId?: string
  embedded?: boolean
  /**
   * Pixel width to reserve on the right of the table's scroll content for the
   * currently-open slideout panel (column config, workflow config, or log
   * details). Computed by the wrapper so it can subscribe to whichever panel
   * width source is relevant. `0` when no panel is open.
   */
  sidebarReservedPx: number
  /**
   * Open requests fired by the grid (column header click, "+ New column"
   * dropdown, context-menu items). The wrapper owns the actual panel state
   * and enforces mutual-exclusion (only one slideout open at a time).
   */
  onOpenColumnConfig: (cfg: ColumnConfig) => void
  onOpenWorkflowConfig: (cfg: WorkflowConfig) => void
  onOpenExecutionDetails: (executionId: string) => void
  /** Open the row-edit modal for `row`. Wrapper renders the modal. */
  onOpenRowModal: (row: TableRowType) => void
  /** Open the row-delete modal for `snapshots`. Wrapper renders the modal. */
  onRequestDeleteRows: (snapshots: DeletedRowSnapshot[]) => void
  /** Open the delete-columns confirmation modal for `names`. Wrapper renders the modal. */
  onRequestDeleteColumns: (names: string[]) => void
  /** Fire run for a single column (meta-cell Run menu). */
  onRunColumn: (groupId: string, runMode: RunMode, rowIds?: string[]) => void
  /** Fire every runnable column on a single row (per-row gutter Play). */
  onRunRow: (rowId: string) => void
  /** Fan out a run across every workflow group on `rowIds`. Used by context menu. */
  onRunRows: (rowIds: string[], runMode: RunMode) => void
  /** Stop running workflows on `rowIds`. Per-row gutter Stop also funnels through here. */
  onStopRows: (rowIds: string[]) => void
  /** Single-row stop for the per-row gutter button. */
  onStopRow: (rowId: string) => void
  /** Wholesale cancel — page-header "Stop all". */
  onStopAll: () => void
  /** Whether `useCancelTableRuns` is currently in flight. */
  cancelRunsPending: boolean
  /**
   * Fired whenever the action-bar selection or running-count derivations
   * change. Wrapper uses this to render <TableActionBar>.
   */
  onSelectionChange: (state: SelectionSnapshot) => void
  /** Filter + sort. Lifted to wrapper so a single `useTable` call serves both. */
  queryOptions: QueryOptions
  /**
   * Ref the grid populates with its `handleColumnRename` so the wrapper's
   * sidebars can fire a column rename back into the grid (rewrites local
   * `columnWidths` / `columnOrder` keys). The wrapper just forwards the call.
   */
  columnRenameSinkRef: React.MutableRefObject<((oldName: string, newName: string) => void) | null>
  /**
   * Ref the grid populates with its post-row-delete cleanup (push undo,
   * clear selection). The wrapper invokes after the row-delete modal's
   * mutation succeeds.
   */
  afterDeleteRowsSinkRef: React.MutableRefObject<((snapshots: DeletedRowSnapshot[]) => void) | null>
  /**
   * Ref the grid populates with its full delete-columns cascade (per-column
   * mutation, undo push, columnOrder + columnWidths cleanup). The wrapper's
   * delete-columns confirmation modal invokes this on confirm.
   */
  confirmDeleteColumnsSinkRef: React.MutableRefObject<((names: string[]) => void) | null>
  /**
   * Ref the grid populates with its `pushUndo({ type: 'rename-table', ... })`
   * call. The wrapper's table-rename `onSave` invokes this so the rename is
   * undoable from anywhere in the grid.
   */
  pushTableRenameUndoSinkRef: React.MutableRefObject<
    ((previousName: string, newName: string) => void) | null
  >
}

/**
 * Split updates into chunks bounded by the server batch-size limit, dispatching
 * up to 3 chunks concurrently. Throws on first failure — `Promise.all` rejects
 * immediately, so partial success cannot leave the table in an ambiguous state.
 */
async function chunkBatchUpdates(
  updates: Array<{ rowId: string; data: Record<string, unknown> }>,
  mutateAsync: (args: {
    updates: Array<{ rowId: string; data: Record<string, unknown> }>
  }) => Promise<unknown>
): Promise<void> {
  const size = TABLE_LIMITS.MAX_BULK_OPERATION_SIZE
  const chunks: Array<Array<{ rowId: string; data: Record<string, unknown> }>> = []
  for (let i = 0; i < updates.length; i += size) {
    chunks.push(updates.slice(i, i + size))
  }
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(3, chunks.length) }, async () => {
      while (cursor < chunks.length) {
        await mutateAsync({ updates: chunks[cursor++]! })
      }
    })
  )
}

export function TableGrid({
  workspaceId: propWorkspaceId,
  tableId: propTableId,
  embedded,
  sidebarReservedPx,
  onOpenColumnConfig,
  onOpenWorkflowConfig,
  onOpenExecutionDetails,
  onOpenRowModal,
  onRequestDeleteRows,
  onRequestDeleteColumns,
  onRunColumn,
  onRunRow,
  onRunRows,
  onStopRows,
  onStopRow,
  onStopAll,
  cancelRunsPending,
  onSelectionChange,
  queryOptions,
  columnRenameSinkRef,
  afterDeleteRowsSinkRef,
  confirmDeleteColumnsSinkRef,
  pushTableRenameUndoSinkRef,
}: TableGridProps) {
  const params = useParams()
  const workspaceId = propWorkspaceId || (params.workspaceId as string)
  const tableId = propTableId || (params.tableId as string)
  const posthog = usePostHog()

  useEffect(() => {
    if (!tableId || !workspaceId) return
    captureEvent(posthog, 'table_opened', { table_id: tableId, workspace_id: workspaceId })
  }, [tableId, workspaceId, posthog])

  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [initialCharacter, setInitialCharacter] = useState<string | null>(null)
  const [expandedCell, setExpandedCell] = useState<EditingCell | null>(null)
  const [selectionAnchor, setSelectionAnchor] = useState<CellCoord | null>(null)
  const [selectionFocus, setSelectionFocus] = useState<CellCoord | null>(null)
  const [rowSelection, setRowSelection] = useState<RowSelection>(ROW_SELECTION_NONE)
  const [isColumnSelection, setIsColumnSelection] = useState(false)
  const lastCheckboxRowRef = useRef<string | null>(null)
  const isColumnSelectionRef = useRef(false)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const columnWidthsRef = useRef(columnWidths)
  columnWidthsRef.current = columnWidths
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const [columnOrder, setColumnOrder] = useState<string[] | null>(null)
  const columnOrderRef = useRef(columnOrder)
  columnOrderRef.current = columnOrder
  const [dragColumnName, setDragColumnName] = useState<string | null>(null)
  const dragColumnNameRef = useRef(dragColumnName)
  dragColumnNameRef.current = dragColumnName
  const [dropTargetColumnName, setDropTargetColumnName] = useState<string | null>(null)
  const dropTargetColumnNameRef = useRef(dropTargetColumnName)
  dropTargetColumnNameRef.current = dropTargetColumnName
  const [dropSide, setDropSide] = useState<'left' | 'right'>('left')
  const dropSideRef = useRef(dropSide)
  dropSideRef.current = dropSide
  const metadataSeededRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const suppressFocusScrollRef = useRef(false)

  const {
    tableData,
    isLoadingTable,
    rows,
    isLoadingRows,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    workflows,
    columns,
    tableWorkflowGroups,
    workflowStates,
    columnSourceInfo,
    ensureAllRowsLoaded,
  } = useTable({ workspaceId, tableId, queryOptions })

  const fetchNextPageRef = useRef(fetchNextPage)
  fetchNextPageRef.current = fetchNextPage
  const hasNextPageRef = useRef(hasNextPage)
  hasNextPageRef.current = hasNextPage
  const isFetchingNextPageRef = useRef(isFetchingNextPage)
  isFetchingNextPageRef.current = isFetchingNextPage
  const ensureAllRowsLoadedRef = useRef(ensureAllRowsLoaded)
  ensureAllRowsLoadedRef.current = ensureAllRowsLoaded
  const isAppendingRowRef = useRef(false)

  const userPermissions = useUserPermissionsContext()
  const canEditRef = useRef(userPermissions.canEdit)
  canEditRef.current = userPermissions.canEdit
  // Refs for callback props read inside effects with stable empty deps.
  const onOpenRowModalRef = useRef(onOpenRowModal)
  onOpenRowModalRef.current = onOpenRowModal

  const {
    contextMenu,
    handleRowContextMenu: baseHandleRowContextMenu,
    closeContextMenu,
  } = useContextMenu()

  const workflowsRef = useRef(workflows)
  workflowsRef.current = workflows

  const updateRowMutation = useUpdateTableRow({ workspaceId, tableId })
  const createRowMutation = useCreateTableRow({ workspaceId, tableId })
  const batchCreateRowsMutation = useBatchCreateTableRows({ workspaceId, tableId })
  const batchUpdateRowsMutation = useBatchUpdateTableRows({ workspaceId, tableId })
  const addColumnMutation = useAddTableColumn({ workspaceId, tableId })
  const updateColumnMutation = useUpdateColumn({ workspaceId, tableId })
  const deleteColumnMutation = useDeleteColumn({ workspaceId, tableId })
  const updateMetadataMutation = useUpdateTableMetadata({ workspaceId, tableId })
  const deleteWorkflowGroupMutation = useDeleteWorkflowGroup({ workspaceId, tableId })
  const updateWorkflowGroupMutation = useUpdateWorkflowGroup({ workspaceId, tableId })

  function handleRunColumn(groupId: string, runMode: RunMode = 'all', rowIds?: string[]) {
    onRunColumn(groupId, runMode, rowIds)
  }

  const handleViewWorkflow = useCallback(
    (workflowId: string) => {
      window.open(`/workspace/${workspaceId}/w/${workflowId}`, '_blank', 'noopener,noreferrer')
    },
    [workspaceId]
  )

  function handleColumnOrderChange(order: string[]) {
    setColumnOrder(order)
  }

  // Width keys are either the logical name or `${name}::${path}` for fanned-out
  // workflow columns; rename must rewrite every key whose prefix matches.
  function handleColumnRename(oldName: string, newName: string) {
    let updatedWidths = columnWidthsRef.current
    let widthsChanged = false
    const nextWidths: Record<string, number> = {}
    for (const [key, width] of Object.entries(updatedWidths)) {
      if (key === oldName) {
        nextWidths[newName] = width
        widthsChanged = true
      } else if (key.startsWith(`${oldName}::`)) {
        nextWidths[`${newName}${key.slice(oldName.length)}`] = width
        widthsChanged = true
      } else {
        nextWidths[key] = width
      }
    }
    if (widthsChanged) {
      updatedWidths = nextWidths
      setColumnWidths(updatedWidths)
    }
    const updatedOrder = columnOrderRef.current?.map((n) => (n === oldName ? newName : n))
    if (updatedOrder) setColumnOrder(updatedOrder)
    updateMetadataRef.current({
      columnWidths: updatedWidths,
      ...(updatedOrder ? { columnOrder: updatedOrder } : {}),
    })
  }
  // Populate the wrapper's sink so its sidebars can fire renames back into
  // the grid. Reads through refs, so identity stability isn't required.
  columnRenameSinkRef.current = handleColumnRename

  function getColumnWidths() {
    return columnWidthsRef.current
  }

  function handleColumnWidthsChange(widths: Record<string, number>) {
    setColumnWidths(widths)
  }

  const { pushUndo, undo, redo } = useTableUndo({
    workspaceId,
    tableId,
    onColumnOrderChange: handleColumnOrderChange,
    onColumnRename: handleColumnRename,
    onColumnWidthsChange: handleColumnWidthsChange,
    getColumnWidths,
  })
  const undoRef = useRef(undo)
  undoRef.current = undo
  const redoRef = useRef(redo)
  redoRef.current = redo
  const pushUndoRef = useRef(pushUndo)
  pushUndoRef.current = pushUndo

  const displayColumns = useMemo<DisplayColumn[]>(() => {
    let ordered: ColumnDefinition[]
    if (!columnOrder || columnOrder.length === 0) {
      ordered = columns
    } else {
      const colMap = new Map(columns.map((c) => [c.name, c]))
      ordered = []
      for (const name of columnOrder) {
        const col = colMap.get(name)
        if (col) {
          ordered.push(col)
          colMap.delete(name)
        }
      }
      for (const col of colMap.values()) {
        ordered.push(col)
      }
    }
    return expandToDisplayColumns(ordered, tableWorkflowGroups)
  }, [columns, columnOrder, tableWorkflowGroups])

  const hasWorkflowColumns = columns.some((c) => !!c.workflowGroupId)
  const { colWidth: checkboxColWidth, numDivWidth } = checkboxColLayout(
    tableData?.maxRows ?? 0,
    hasWorkflowColumns
  )

  const headerGroups = useMemo(
    () => buildHeaderGroups(displayColumns, tableWorkflowGroups),
    [displayColumns, tableWorkflowGroups]
  )
  const hasWorkflowGroup = headerGroups.some((g) => g.kind === 'workflow')

  const normalizedSelection = useMemo(
    () => computeNormalizedSelection(selectionAnchor, selectionFocus),
    [selectionAnchor, selectionFocus]
  )

  const displayColCount = isLoadingTable ? SKELETON_COL_COUNT : displayColumns.length
  const tableWidth = useMemo(() => {
    const colsWidth = isLoadingTable
      ? displayColCount * COL_WIDTH
      : displayColumns.reduce((sum, col) => sum + (columnWidths[col.key] ?? COL_WIDTH), 0)
    return checkboxColWidth + colsWidth + ADD_COL_WIDTH
  }, [isLoadingTable, displayColCount, displayColumns, columnWidths, checkboxColWidth])

  const resizeIndicatorLeft = useMemo(() => {
    if (!resizingColumn) return 0
    let left = checkboxColWidth
    for (const col of displayColumns) {
      left += columnWidths[col.key] ?? COL_WIDTH
      if (col.key === resizingColumn) return left
    }
    return 0
  }, [resizingColumn, displayColumns, columnWidths, checkboxColWidth])

  const dropColumnBounds = useMemo(() => {
    if (!dropTargetColumnName || !dragColumnName) return null
    if (dropTargetColumnName === dragColumnName) return null

    // Drag/drop targets are LOGICAL columns; with fan-out, multiple visual columns
    // share the same `name`. Compute the group's left edge and total width by
    // accumulating across siblings.
    const cols = displayColumns
    const dragGroup = cols.findIndex((c) => c.name === dragColumnName)
    const targetGroupStart = cols.findIndex((c) => c.name === dropTargetColumnName)
    if (dragGroup === -1 || targetGroupStart === -1) return null

    const dragGroupSize = cols[dragGroup].groupSize
    const targetGroupSize = cols[targetGroupStart].groupSize
    const wouldBeNoOp =
      (dropSide === 'right' && targetGroupStart + targetGroupSize === dragGroup) ||
      (dropSide === 'left' && targetGroupStart === dragGroup + dragGroupSize)
    if (wouldBeNoOp) return null

    let left = checkboxColWidth
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i]
      const w = columnWidths[col.key] ?? COL_WIDTH
      if (i === targetGroupStart) {
        // Clamp `targetGroupSize` to remaining columns — the memo's deps may not
        // have settled in lockstep when a group shrinks (column removed) and we
        // can briefly read past the end of `cols`.
        const safeGroupSize = Math.min(targetGroupSize, cols.length - i)
        let groupWidth = 0
        for (let j = 0; j < safeGroupSize; j++) {
          groupWidth += columnWidths[cols[i + j].key] ?? COL_WIDTH
        }
        const lineLeft = dropSide === 'left' ? left : left + groupWidth
        return { left, width: groupWidth, lineLeft }
      }
      left += w
    }
    return null
  }, [
    dropTargetColumnName,
    dragColumnName,
    dropSide,
    displayColumns,
    columnWidths,
    checkboxColWidth,
  ])

  const isAllRowsSelected = useMemo(
    () => rowSelectionCoversAll(rowSelection, rows),
    [rowSelection, rows]
  )

  const isAllRowsSelectedRef = useRef(isAllRowsSelected)
  isAllRowsSelectedRef.current = isAllRowsSelected

  const columnsRef = useRef(displayColumns)
  const schemaColumnsRef = useRef(columns)
  const workflowGroupsRef = useRef(tableWorkflowGroups)
  const rowsRef = useRef(rows)
  const selectionAnchorRef = useRef(selectionAnchor)
  const selectionFocusRef = useRef(selectionFocus)
  const anchorRowIdRef = useRef<string | null>(null)
  const focusRowIdRef = useRef<string | null>(null)

  const rowSelectionRef = useRef(rowSelection)
  rowSelectionRef.current = rowSelection

  columnsRef.current = displayColumns
  schemaColumnsRef.current = columns
  workflowGroupsRef.current = tableWorkflowGroups
  rowsRef.current = rows
  selectionAnchorRef.current = selectionAnchor
  selectionFocusRef.current = selectionFocus
  isColumnSelectionRef.current = isColumnSelection
  anchorRowIdRef.current = selectionAnchor
    ? (rowsRef.current[selectionAnchor.rowIndex]?.id ?? null)
    : null
  focusRowIdRef.current = selectionFocus
    ? (rowsRef.current[selectionFocus.rowIndex]?.id ?? null)
    : null

  const columnRename = useInlineRename({
    onSave: (columnName, newName) => {
      pushUndoRef.current({ type: 'rename-column', oldName: columnName, newName })
      handleColumnRename(columnName, newName)
      updateColumnMutation.mutate({ columnName, updates: { name: newName } })
    },
  })

  const toggleBooleanCell = useCallback(
    (rowId: string, columnName: string, currentValue: unknown) => {
      const newValue = !currentValue
      pushUndoRef.current({
        type: 'update-cell',
        rowId,
        columnName,
        previousValue: currentValue ?? null,
        newValue,
      })
      mutateRef.current({ rowId, data: { [columnName]: newValue } })
    },
    []
  )

  function handleContextMenuEditCell() {
    if (contextMenu.row && contextMenu.columnName) {
      const column = columnsRef.current.find((c) => c.name === contextMenu.columnName)
      if (column?.type === 'boolean') {
        toggleBooleanCell(
          contextMenu.row.id,
          contextMenu.columnName,
          contextMenu.row.data[contextMenu.columnName]
        )
      } else if (column) {
        setEditingCell({ rowId: contextMenu.row.id, columnName: contextMenu.columnName })
        setInitialCharacter(null)
      }
    }
    closeContextMenu()
  }

  function handleContextMenuDelete() {
    const contextRow = contextMenu.row
    if (!contextRow) {
      closeContextMenu()
      return
    }

    const rowSel = rowSelectionRef.current
    const currentRows = rowsRef.current
    let snapshots: DeletedRowSnapshot[] = []

    const contextRowInRows = currentRows.some((r) => r.id === contextRow.id)

    if (rowSel.kind === 'all' && contextRowInRows) {
      snapshots = collectRowSnapshots(currentRows)
    } else if (rowSel.kind === 'some' && rowSel.ids.has(contextRow.id)) {
      snapshots = collectRowSnapshots(currentRows.filter((r) => rowSel.ids.has(r.id)))
    } else {
      const sel = computeNormalizedSelection(selectionAnchorRef.current, selectionFocusRef.current)
      const contextRowArrayIndex = currentRows.findIndex((r) => r.id === contextRow.id)
      const isInSelection =
        sel !== null && contextRowArrayIndex >= sel.startRow && contextRowArrayIndex <= sel.endRow

      if (isInSelection && sel) {
        snapshots = collectRowSnapshots(currentRows.slice(sel.startRow, sel.endRow + 1))
      } else {
        snapshots = [
          { rowId: contextRow.id, data: { ...contextRow.data }, position: contextRow.position },
        ]
      }
    }

    if (snapshots.length > 0) {
      onRequestDeleteRows(snapshots)
    }

    closeContextMenu()
  }

  function handleInsertRow(offset: 0 | 1) {
    if (!contextMenu.row) return
    const position = contextMenu.row.position + offset
    createRef.current(
      { data: {}, position },
      {
        onSuccess: (response: Record<string, unknown>) => {
          const newRowId = extractCreatedRowId(response)
          if (newRowId) {
            pushUndoRef.current({ type: 'create-row', rowId: newRowId, position })
          }
        },
      }
    )
    closeContextMenu()
  }

  const handleInsertRowAbove = () => handleInsertRow(0)
  const handleInsertRowBelow = () => handleInsertRow(1)

  let contextMenuExecutionId: string | null = null
  let contextMenuIsWorkflowColumn = false
  let contextMenuHasStartedRun = false
  if (contextMenu.row && contextMenu.columnName) {
    const _col = columnsRef.current.find((c) => c.name === contextMenu.columnName)
    const _gid = _col?.workflowGroupId
    if (_col && _gid) {
      const _exec = contextMenu.row.executions?.[_gid]
      contextMenuIsWorkflowColumn = true
      // Only `completed` / `error` / `running` cells are guaranteed to have a
      // server-side execution log. `queued` / `pending` haven't started yet;
      // `cancelled` may have been cancelled before the worker ever picked the
      // job up, so its executionId can't be relied on either.
      contextMenuHasStartedRun =
        _exec?.status === 'completed' || _exec?.status === 'error' || _exec?.status === 'running'
      contextMenuExecutionId = _exec?.executionId ?? null
    }
  }

  function handleViewExecution() {
    if (!contextMenuExecutionId) return
    onOpenExecutionDetails(contextMenuExecutionId)
    closeContextMenu()
  }

  function handleDuplicateRow() {
    const contextRow = contextMenu.row
    if (!contextRow) return
    const rowData = { ...contextRow.data }
    const position = contextRow.position + 1
    const sourceArrayIndex = rowsRef.current.findIndex((r) => r.id === contextRow.id)
    closeContextMenu()
    createRef.current(
      { data: rowData, position },
      {
        onSuccess: (response: Record<string, unknown>) => {
          const newRowId = extractCreatedRowId(response)
          if (newRowId) {
            pushUndoRef.current({
              type: 'create-row',
              rowId: newRowId,
              position,
              data: rowData,
            })
          }
          const colIndex = selectionAnchorRef.current?.colIndex ?? 0
          if (sourceArrayIndex !== -1) {
            setSelectionAnchor({ rowIndex: sourceArrayIndex + 1, colIndex })
            setSelectionFocus(null)
          }
        },
      }
    )
  }

  const handleAppendRow = useCallback(async () => {
    if (isAppendingRowRef.current) return
    isAppendingRowRef.current = true
    try {
      while (hasNextPageRef.current) {
        const result = await fetchNextPageRef.current()
        if (!result.hasNextPage) break
      }
    } catch (error) {
      isAppendingRowRef.current = false
      logger.error('Failed to load remaining rows before appending', { error })
      toast.error('Failed to load all rows. Try again.', { duration: 5000 })
      return
    }

    createRef.current(
      { data: {} },
      {
        onSuccess: (response: Record<string, unknown>) => {
          const newRowId = extractCreatedRowId(response)
          if (newRowId) {
            const maxPosition = rowsRef.current.reduce((max, r) => Math.max(max, r.position), -1)
            pushUndoRef.current({
              type: 'create-row',
              rowId: newRowId,
              position: maxPosition + 1,
            })
          }
        },
        onSettled: () => {
          isAppendingRowRef.current = false
        },
      }
    )
  }, [])

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, row: TableRowType) => {
      setEditingCell(null)
      const td = (e.target as HTMLElement).closest('td[data-col]') as HTMLElement | null
      let columnName: string | null = null
      if (td) {
        const rowIndex = Number.parseInt(td.getAttribute('data-row') || '-1', 10)
        const colIndex = Number.parseInt(td.getAttribute('data-col') || '-1', 10)
        if (rowIndex >= 0 && colIndex >= 0) {
          columnName =
            colIndex < columnsRef.current.length ? columnsRef.current[colIndex].name : null

          const sel = computeNormalizedSelection(
            selectionAnchorRef.current,
            selectionFocusRef.current
          )
          const isWithinSelection =
            sel !== null &&
            rowIndex >= sel.startRow &&
            rowIndex <= sel.endRow &&
            colIndex >= sel.startCol &&
            colIndex <= sel.endCol

          if (!isWithinSelection) {
            setSelectionAnchor({ rowIndex, colIndex })
            setSelectionFocus(null)
            setIsColumnSelection(false)
          }
        }
      }
      baseHandleRowContextMenu(e, row, columnName)
    },
    [baseHandleRowContextMenu]
  )

  const handleCellMouseDown = useCallback(
    (rowIndex: number, colIndex: number, shiftKey: boolean) => {
      setRowSelection((prev) => (prev.kind === 'none' ? prev : ROW_SELECTION_NONE))
      setIsColumnSelection(false)
      lastCheckboxRowRef.current = null
      if (shiftKey && selectionAnchorRef.current) {
        setSelectionFocus({ rowIndex, colIndex })
      } else {
        setSelectionAnchor({ rowIndex, colIndex })
        setSelectionFocus(null)
      }
      isDraggingRef.current = true
      scrollRef.current?.focus({ preventScroll: true })
    },
    []
  )

  const handleCellMouseEnter = useCallback((rowIndex: number, colIndex: number) => {
    if (!isDraggingRef.current) return
    setSelectionFocus({ rowIndex, colIndex })
  }, [])

  const handleRowToggle = useCallback((rowIndex: number, shiftKey: boolean) => {
    setEditingCell(null)
    setSelectionAnchor(null)
    setSelectionFocus(null)
    setIsColumnSelection(false)

    const currentRows = rowsRef.current
    const targetRow = currentRows[rowIndex]
    if (!targetRow) return
    const targetId = targetRow.id

    const lastIdx =
      shiftKey && lastCheckboxRowRef.current !== null
        ? currentRows.findIndex((r) => r.id === lastCheckboxRowRef.current)
        : -1

    setRowSelection((prev) => {
      const next = rowSelectionMaterialize(prev, currentRows)
      if (lastIdx !== -1) {
        const from = Math.min(lastIdx, rowIndex)
        const to = Math.max(lastIdx, rowIndex)
        for (let i = from; i <= to; i++) {
          const r = currentRows[i]
          if (r) next.add(r.id)
        }
      } else if (next.has(targetId)) {
        next.delete(targetId)
      } else {
        next.add(targetId)
      }
      return next.size === 0 ? ROW_SELECTION_NONE : { kind: 'some', ids: next }
    })
    lastCheckboxRowRef.current = targetId
    scrollRef.current?.focus({ preventScroll: true })
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectionAnchor(null)
    setSelectionFocus(null)
    setRowSelection((prev) => (prev.kind === 'none' ? prev : ROW_SELECTION_NONE))
    setIsColumnSelection(false)
    lastCheckboxRowRef.current = null
  }, [])

  // Populate the wrapper's after-delete sink so the row-delete modal can run
  // grid cleanup (push undo + clear selection) once its mutation succeeds.
  afterDeleteRowsSinkRef.current = (snapshots: DeletedRowSnapshot[]) => {
    pushUndoRef.current({ type: 'delete-rows', rows: snapshots })
    handleClearSelection()
  }

  // Populate the wrapper's table-rename undo sink. The wrapper's <ResourceHeader>
  // breadcrumb rename calls back here so the rename is part of the grid's undo
  // stack (Cmd-Z restores the previous name).
  pushTableRenameUndoSinkRef.current = (previousName: string, newName: string) => {
    pushUndoRef.current({ type: 'rename-table', tableId, previousName, newName })
  }

  const handleColumnSelect = useCallback((colIndex: number, shiftKey: boolean) => {
    const lastRow = rowsRef.current.length - 1
    if (lastRow < 0) return

    setEditingCell(null)
    setRowSelection((prev) => (prev.kind === 'none' ? prev : ROW_SELECTION_NONE))
    lastCheckboxRowRef.current = null

    if (shiftKey && isColumnSelectionRef.current && selectionAnchorRef.current) {
      setSelectionFocus({ rowIndex: lastRow, colIndex })
    } else {
      setSelectionAnchor({ rowIndex: 0, colIndex })
      setSelectionFocus({ rowIndex: lastRow, colIndex })
      setIsColumnSelection(true)
    }

    scrollRef.current?.focus({ preventScroll: true })
  }, [])

  const handleGroupSelect = useCallback((startColIndex: number, size: number) => {
    const lastRow = rowsRef.current.length - 1
    if (lastRow < 0) return

    setEditingCell(null)
    setRowSelection((prev) => (prev.kind === 'none' ? prev : ROW_SELECTION_NONE))
    lastCheckboxRowRef.current = null

    setSelectionAnchor({ rowIndex: 0, colIndex: startColIndex })
    setSelectionFocus({ rowIndex: lastRow, colIndex: startColIndex + size - 1 })
    setIsColumnSelection(true)

    scrollRef.current?.focus({ preventScroll: true })
  }, [])

  const handleSelectAllRows = useCallback(() => {
    const rws = rowsRef.current
    const currentCols = columnsRef.current
    if (rws.length === 0 || currentCols.length === 0) return
    setEditingCell(null)
    setRowSelection(ROW_SELECTION_ALL)
    lastCheckboxRowRef.current = null
    suppressFocusScrollRef.current = true
    setSelectionAnchor({ rowIndex: 0, colIndex: 0 })
    setSelectionFocus({
      rowIndex: rws.length - 1,
      colIndex: currentCols.length - 1,
    })
    setIsColumnSelection(false)
    scrollRef.current?.focus({ preventScroll: true })
  }, [])

  const handleSelectAllToggle = useCallback(() => {
    if (isAllRowsSelectedRef.current) {
      handleClearSelection()
    } else {
      handleSelectAllRows()
    }
  }, [handleClearSelection, handleSelectAllRows])

  const handleColumnResizeStart = useCallback((columnKey: string) => {
    setResizingColumn(columnKey)
  }, [])

  const handleColumnResize = useCallback((columnKey: string, width: number) => {
    setColumnWidths((prev) => ({ ...prev, [columnKey]: Math.max(COL_WIDTH_MIN, width) }))
  }, [])

  const handleColumnResizeEnd = useCallback(() => {
    setResizingColumn(null)
    updateMetadataRef.current({ columnWidths: columnWidthsRef.current })
  }, [])

  const handleColumnAutoResize = useCallback((columnKey: string) => {
    const cols = columnsRef.current
    const colIndex = cols.findIndex((c) => c.key === columnKey)
    if (colIndex === -1) return

    const column = cols[colIndex]
    if (column.type === 'boolean') return

    const host = containerRef.current ?? document.body
    const currentRows = rowsRef.current
    let maxWidth = COL_WIDTH_MIN

    const measure = document.createElement('span')
    measure.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;top:-9999px'
    host.appendChild(measure)

    try {
      measure.className = 'font-medium text-small'
      measure.textContent = column.headerLabel
      maxWidth = Math.max(maxWidth, measure.getBoundingClientRect().width + 57)

      measure.className = 'text-small'
      for (const row of currentRows) {
        const val = row.data[column.name]
        if (val == null) continue
        let text: string
        if (column.type === 'json') {
          if (typeof val === 'string') {
            text = val
          } else {
            try {
              text = JSON.stringify(val)
            } catch {
              text = String(val)
            }
          }
        } else if (column.type === 'date') {
          text = storageToDisplay(String(val))
        } else {
          text = String(val)
        }
        measure.textContent = text
        maxWidth = Math.max(maxWidth, measure.getBoundingClientRect().width + 17)
      }
    } finally {
      host.removeChild(measure)
    }

    const newWidth = Math.min(Math.ceil(maxWidth), COL_WIDTH_AUTO_FIT_MAX)
    setColumnWidths((prev) => ({ ...prev, [columnKey]: newWidth }))
    const updated = { ...columnWidthsRef.current, [columnKey]: newWidth }
    columnWidthsRef.current = updated
    updateMetadataRef.current({ columnWidths: updated })
  }, [])

  const handleColumnDragStart = useCallback((columnName: string) => {
    setDragColumnName(columnName)
    setSelectionAnchor(null)
    setSelectionFocus(null)
    setRowSelection((prev) => (prev.kind === 'none' ? prev : ROW_SELECTION_NONE))
    setIsColumnSelection(false)
  }, [])

  const handleColumnDragOver = useCallback((columnName: string, side: 'left' | 'right') => {
    const dragged = dragColumnNameRef.current
    const cols = schemaColumnsRef.current
    const targetCol = cols.find((c) => c.name === columnName)
    const targetGid = targetCol?.workflowGroupId

    // Suppress drop targeting while hovering siblings of the dragged column's
    // own group: reordering inside a group is meaningless (the group renders
    // as a unit) and the chasing indicator just flickers.
    if (dragged) {
      const draggedGid = cols.find((c) => c.name === dragged)?.workflowGroupId
      if (draggedGid && draggedGid === targetGid) {
        if (dropTargetColumnNameRef.current !== null) setDropTargetColumnName(null)
        return
      }
    }

    // Workflow groups: skip per-`<th>` writes and let `handleScrollDragOver`
    // do the bookkeeping. The scroll handler computes side from the group's
    // full bounds, so it stays stable across sibling cursor moves; the per-th
    // events would otherwise oscillate name + side as the cursor crosses each
    // sibling's midpoint.
    if (targetGid) return

    if (columnName === dropTargetColumnNameRef.current && side === dropSideRef.current) return
    setDropTargetColumnName(columnName)
    setDropSide(side)
  }, [])

  const handleColumnDragEnd = useCallback(() => {
    const dragged = dragColumnNameRef.current
    if (!dragged) {
      setDragColumnName(null)
      setDropTargetColumnName(null)
      setDropSide('left')
      return
    }
    dragColumnNameRef.current = null
    const target = dropTargetColumnNameRef.current
    const side = dropSideRef.current
    if (target && dragged !== target) {
      const schemaCols = schemaColumnsRef.current
      // `columnOrder` is the user-edited persisted order. Tables created
      // before the server kept it in sync with `addColumn` may have entries
      // missing — append any unknown schema names so the dragged column is
      // always indexable. The next reorder write persists the reconciled
      // list, healing the table going forward.
      const persisted = columnOrderRef.current ?? schemaCols.map((c) => c.name)
      const known = new Set(persisted)
      const missing = schemaCols.map((c) => c.name).filter((n) => !known.has(n))
      const currentOrder = missing.length > 0 ? [...persisted, ...missing] : persisted

      // Group-aware reorder: a workflow group's outputs must stay contiguous in
      // the persisted column order (`workflow-columns.ts` validates this on
      // save). So we treat the entire group as the unit being moved when the
      // dragged column belongs to one, and snap the drop position to the
      // outside edge of any group the target belongs to.
      const colByName = new Map(schemaCols.map((c) => [c.name, c]))
      const draggedGid = colByName.get(dragged)?.workflowGroupId

      const orderIndex = new Map<string, number>()
      currentOrder.forEach((n, i) => orderIndex.set(n, i))

      // Compute the contiguous run covering the dragged column. For a plain
      // column this is just [fromIndex, fromIndex]. For a group member it spans
      // every sibling sharing the same workflowGroupId.
      const fromIndex = orderIndex.get(dragged) ?? -1
      if (fromIndex === -1) {
        setDragColumnName(null)
        setDropTargetColumnName(null)
        setDropSide('left')
        return
      }
      let runStart = fromIndex
      let runEnd = fromIndex
      if (draggedGid) {
        while (
          runStart > 0 &&
          colByName.get(currentOrder[runStart - 1])?.workflowGroupId === draggedGid
        ) {
          runStart--
        }
        while (
          runEnd < currentOrder.length - 1 &&
          colByName.get(currentOrder[runEnd + 1])?.workflowGroupId === draggedGid
        ) {
          runEnd++
        }
      }
      const movedNames = currentOrder.slice(runStart, runEnd + 1)

      // Resolve the *anchor* index in `currentOrder` to drop next to. If the
      // target belongs to a group (and not the dragged group), snap to that
      // group's outer edge so we never split it.
      const targetIdx = orderIndex.get(target) ?? -1
      if (targetIdx === -1) {
        setDragColumnName(null)
        setDropTargetColumnName(null)
        setDropSide('left')
        return
      }
      const targetGid = colByName.get(target)?.workflowGroupId
      let anchorStart = targetIdx
      let anchorEnd = targetIdx
      if (targetGid && targetGid !== draggedGid) {
        while (
          anchorStart > 0 &&
          colByName.get(currentOrder[anchorStart - 1])?.workflowGroupId === targetGid
        ) {
          anchorStart--
        }
        while (
          anchorEnd < currentOrder.length - 1 &&
          colByName.get(currentOrder[anchorEnd + 1])?.workflowGroupId === targetGid
        ) {
          anchorEnd++
        }
      }
      // No-op if dropping the dragged run onto itself.
      if (anchorStart >= runStart && anchorEnd <= runEnd) {
        setDragColumnName(null)
        setDropTargetColumnName(null)
        setDropSide('left')
        return
      }

      const remaining = currentOrder.filter((_, i) => i < runStart || i > runEnd)
      // After removing the moved run, recompute the anchor's name-based index.
      const anchorName = side === 'left' ? currentOrder[anchorStart] : currentOrder[anchorEnd]
      let insertIndex = remaining.indexOf(anchorName)
      if (insertIndex === -1) insertIndex = remaining.length
      if (side === 'right') insertIndex += 1
      const newOrder = [
        ...remaining.slice(0, insertIndex),
        ...movedNames,
        ...remaining.slice(insertIndex),
      ]

      const orderChanged = newOrder.some((name, i) => currentOrder[i] !== name)
      if (orderChanged) {
        pushUndoRef.current({
          type: 'reorder-columns',
          previousOrder: currentOrder,
          newOrder,
        })
        setColumnOrder(newOrder)
        updateMetadataRef.current({
          columnWidths: columnWidthsRef.current,
          columnOrder: newOrder,
        })
      }
    }
    setDragColumnName(null)
    setDropTargetColumnName(null)
    setDropSide('left')
  }, [])

  const handleColumnDragLeave = useCallback(() => {
    dropTargetColumnNameRef.current = null
    setDropTargetColumnName(null)
  }, [])

  function handleScrollDragOver(e: React.DragEvent) {
    if (!dragColumnNameRef.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const scrollEl = scrollRef.current
    if (!scrollEl) return
    const scrollRect = scrollEl.getBoundingClientRect()
    const cursorX = e.clientX - scrollRect.left + scrollEl.scrollLeft

    const cols = columnsRef.current
    const draggedGid = cols.find((c) => c.name === dragColumnNameRef.current)?.workflowGroupId
    let left = checkboxColWidth
    let i = 0
    while (i < cols.length) {
      const col = cols[i]
      // Treat fanned-out groups as monolithic drop targets; accumulate across siblings.
      // Clamp `groupSize` to remaining columns: dragover fires constantly and can
      // race a column removal where the cached `groupSize` outpaces `cols.length`.
      const groupSize = Math.min(col.groupSize, cols.length - i)
      let groupWidth = 0
      for (let j = 0; j < groupSize; j++) {
        groupWidth += columnWidthsRef.current[cols[i + j].key] ?? COL_WIDTH
      }
      if (cursorX < left + groupWidth) {
        // Inside the dragged column's own group → no-op drop, no indicator.
        if (draggedGid && col.workflowGroupId === draggedGid) {
          if (dropTargetColumnNameRef.current !== null) setDropTargetColumnName(null)
          return
        }
        const midX = left + groupWidth / 2
        const side = cursorX < midX ? 'left' : 'right'
        if (col.name !== dropTargetColumnNameRef.current || side !== dropSideRef.current) {
          setDropTargetColumnName(col.name)
          setDropSide(side)
        }
        return
      }
      left += groupWidth
      i += groupSize
    }
  }

  function handleScrollDrop(e: React.DragEvent) {
    e.preventDefault()
  }

  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return

    const SCROLL_PREFETCH_PX = 600

    function maybeFetchNext() {
      if (!hasNextPageRef.current || isFetchingNextPageRef.current) return
      if (!scrollEl) return
      const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight
      if (distanceFromBottom <= SCROLL_PREFETCH_PX) {
        fetchNextPageRef.current().catch((error) => {
          logger.error('Failed to fetch next page of rows', { error })
        })
      }
    }

    maybeFetchNext()
    scrollEl.addEventListener('scroll', maybeFetchNext, { passive: true })
    return () => {
      scrollEl.removeEventListener('scroll', maybeFetchNext)
    }
  }, [tableData?.id])

  useEffect(() => {
    if (!tableData?.metadata) return
    if (!tableData.metadata.columnWidths && !tableData.metadata.columnOrder) return
    // First load: seed both from the server and remember we've seeded.
    if (!metadataSeededRef.current) {
      metadataSeededRef.current = true
      if (tableData.metadata.columnWidths) {
        setColumnWidths(tableData.metadata.columnWidths)
      }
      if (tableData.metadata.columnOrder) {
        setColumnOrder(tableData.metadata.columnOrder)
      }
      return
    }
    // After first load: only re-seed `columnOrder` when the *set of columns*
    // changes (e.g. a workflow group adds/removes outputs server-side). Pure
    // reorders are left alone so an in-flight optimistic drag isn't clobbered
    // by a refetch returning the pre-drag order.
    const serverOrder = tableData.metadata.columnOrder
    if (serverOrder) {
      const localOrder = columnOrderRef.current
      const serverSet = new Set(serverOrder)
      const localSet = new Set(localOrder ?? [])
      const setChanged =
        !localOrder || serverSet.size !== localSet.size || serverOrder.some((n) => !localSet.has(n))
      if (setChanged) {
        setColumnOrder(serverOrder)
      }
    }
  }, [tableData?.metadata])

  useEffect(() => {
    if (!isColumnSelection || !selectionAnchor) return
    const lastRow = rows.length - 1
    if (lastRow < 0) return
    setSelectionFocus((prev) => {
      if (!prev || prev.rowIndex !== lastRow) {
        return { rowIndex: lastRow, colIndex: prev?.colIndex ?? selectionAnchor.colIndex }
      }
      return prev
    })
  }, [isColumnSelection, rows.length, selectionAnchor])

  useEffect(() => {
    const handleMouseUp = () => {
      isDraggingRef.current = false
    }
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [])

  /**
   * Auto-scroll the table while a cell-drag selection is in progress and the
   * cursor enters a "hot zone" near the top or bottom of the scroll
   * container. Scroll velocity ramps with proximity to the edge (max ~14px /
   * frame at the very edge). The horizontal axis is intentionally left out:
   * the fixed sticky checkbox column makes left-edge hot zones awkward and
   * the table is rarely wider than the viewport in practice.
   */
  useEffect(() => {
    const HOT_ZONE_PX = 48
    const MAX_VELOCITY_PX = 14
    let pointerX: number | null = null
    let pointerY: number | null = null
    let rafId: number | null = null

    /**
     * After auto-scroll moves the table under the cursor, no `mouseenter`
     * fires on newly-revealed cells, so the selection focus would stay stuck
     * on whatever cell was under the cursor when the cursor stopped moving.
     * Manually re-pick the cell under the (unchanged) cursor coords and feed
     * its row/col into the selection so the highlight expands as we scroll.
     */
    const updateFocusUnderCursor = () => {
      if (pointerX === null || pointerY === null) return
      const target = document.elementFromPoint(pointerX, pointerY)
      if (!target) return
      const td = (target as HTMLElement).closest('td[data-row][data-col]') as HTMLElement | null
      if (!td) return
      const rowIndex = Number.parseInt(td.getAttribute('data-row') ?? '', 10)
      const colIndex = Number.parseInt(td.getAttribute('data-col') ?? '', 10)
      if (Number.isNaN(rowIndex) || Number.isNaN(colIndex)) return
      setSelectionFocus({ rowIndex, colIndex })
    }

    const tick = () => {
      rafId = null
      const el = scrollRef.current
      if (!isDraggingRef.current || !el || pointerY === null) return
      const rect = el.getBoundingClientRect()
      const distFromTop = pointerY - rect.top
      const distFromBottom = rect.bottom - pointerY
      let dy = 0
      if (distFromTop < HOT_ZONE_PX) {
        const intensity = 1 - Math.max(0, distFromTop) / HOT_ZONE_PX
        dy = -Math.ceil(intensity * MAX_VELOCITY_PX)
      } else if (distFromBottom < HOT_ZONE_PX) {
        const intensity = 1 - Math.max(0, distFromBottom) / HOT_ZONE_PX
        dy = Math.ceil(intensity * MAX_VELOCITY_PX)
      }
      if (dy !== 0) {
        el.scrollTop += dy
        updateFocusUnderCursor()
        rafId = requestAnimationFrame(tick)
      }
    }

    const handleMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      pointerX = e.clientX
      pointerY = e.clientY
      if (rafId === null) rafId = requestAnimationFrame(tick)
    }

    const handleStop = () => {
      pointerX = null
      pointerY = null
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleStop)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleStop)
      handleStop()
    }
  }, [])

  useEffect(() => {
    // Skip during transient empty-rows state (initial load of a new sort/filter
    // before keepPreviousData kicks in) — clearing here would lose the user's
    // selection across every uncached query change.
    if (rows.length === 0) return
    // Column selections pin focus to the last row via the effect above; remapping
    // by row id would shrink a full-column range to whichever rows happened to be
    // at the endpoints when the selection was captured.
    if (isColumnSelectionRef.current) return
    const anchor = selectionAnchorRef.current
    if (anchor) {
      const expectedId = anchorRowIdRef.current
      const actualId = rows[anchor.rowIndex]?.id ?? null
      if (expectedId && expectedId !== actualId) {
        const newIndex = rows.findIndex((r) => r.id === expectedId)
        if (newIndex >= 0) {
          setSelectionAnchor({ rowIndex: newIndex, colIndex: anchor.colIndex })
        } else {
          setSelectionAnchor(null)
        }
      } else if (anchor.rowIndex >= rows.length) {
        setSelectionAnchor(null)
      }
    }
    const focus = selectionFocusRef.current
    if (focus) {
      const expectedId = focusRowIdRef.current
      const actualId = rows[focus.rowIndex]?.id ?? null
      if (expectedId && expectedId !== actualId) {
        const newIndex = rows.findIndex((r) => r.id === expectedId)
        if (newIndex >= 0) {
          setSelectionFocus({ rowIndex: newIndex, colIndex: focus.colIndex })
        } else {
          setSelectionFocus(null)
        }
      } else if (focus.rowIndex >= rows.length) {
        setSelectionFocus(null)
      }
    }
  }, [rows])

  useEffect(() => {
    if (isColumnSelection) return
    if (suppressFocusScrollRef.current) {
      suppressFocusScrollRef.current = false
      return
    }
    const target = selectionFocus ?? selectionAnchor
    if (!target) return
    const { rowIndex, colIndex } = target
    const rafId = requestAnimationFrame(() => {
      const cell = document.querySelector(
        `[data-table-scroll] [data-row="${rowIndex}"][data-col="${colIndex}"]`
      ) as HTMLElement | null
      cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => cancelAnimationFrame(rafId)
  }, [selectionAnchor, selectionFocus, isColumnSelection])

  const handleCellClick = useCallback(
    (rowId: string, columnName: string, options?: { toggleBoolean?: boolean }) => {
      const column = columnsRef.current.find((c) => c.name === columnName)
      if (column?.type === 'boolean') {
        if (!options?.toggleBoolean || !canEditRef.current) return
        const row = rowsRef.current.find((r) => r.id === rowId)
        if (row) {
          toggleBooleanCell(rowId, columnName, row.data[columnName])
        }
        return
      }

      const current = editingCellRef.current
      if (current && current.rowId === rowId && current.columnName === columnName) return
      setEditingCell(null)
      setInitialCharacter(null)
    },
    []
  )

  const handleCellDoubleClick = useCallback(
    (rowId: string, columnName: string, columnKey: string) => {
      const column = columnsRef.current.find((c) => c.key === columnKey)
      if (column?.type === 'boolean') return

      setSelectionFocus(null)
      setIsColumnSelection(false)

      // Date/number: use inline editor (calendar picker / numeric input).
      if ((column?.type === 'date' || column?.type === 'number') && canEditRef.current) {
        setEditingCell({ rowId, columnName })
        setInitialCharacter(null)
        return
      }

      // Workflow-output cell with no value → let the user write over the status pill.
      if (column?.workflowGroupId && canEditRef.current) {
        const row = rowsRef.current.find((r) => r.id === rowId)
        if (row) {
          const cellValue = row.data[columnName]
          if (cellValue === null || cellValue === undefined || cellValue === '') {
            setEditingCell({ rowId, columnName })
            setInitialCharacter('')
            return
          }
        }
      }

      setExpandedCell({ rowId, columnName, columnKey })
    },
    []
  )

  const mutateRef = useRef(updateRowMutation.mutate)
  mutateRef.current = updateRowMutation.mutate

  const createRef = useRef(createRowMutation.mutate)
  createRef.current = createRowMutation.mutate

  const batchCreateRef = useRef(batchCreateRowsMutation.mutate)
  batchCreateRef.current = batchCreateRowsMutation.mutate

  const batchUpdateRef = useRef(batchUpdateRowsMutation.mutate)
  batchUpdateRef.current = batchUpdateRowsMutation.mutate
  const batchUpdateAsyncRef = useRef(batchUpdateRowsMutation.mutateAsync)
  batchUpdateAsyncRef.current = batchUpdateRowsMutation.mutateAsync

  const updateMetadataRef = useRef(updateMetadataMutation.mutate)
  updateMetadataRef.current = updateMetadataMutation.mutate

  const deleteWorkflowGroupRef = useRef(deleteWorkflowGroupMutation.mutate)
  deleteWorkflowGroupRef.current = deleteWorkflowGroupMutation.mutate

  const updateWorkflowGroupRef = useRef(updateWorkflowGroupMutation.mutate)
  updateWorkflowGroupRef.current = updateWorkflowGroupMutation.mutate

  const toggleBooleanCellRef = useRef(toggleBooleanCell)
  toggleBooleanCellRef.current = toggleBooleanCell

  const editingCellRef = useRef(editingCell)
  editingCellRef.current = editingCell

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'y')) {
        e.preventDefault()
        if (e.key === 'y' || e.shiftKey) {
          redoRef.current()
        } else {
          undoRef.current()
        }
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        if (dragColumnNameRef.current) {
          dragColumnNameRef.current = null
          dropTargetColumnNameRef.current = null
          dropSideRef.current = 'left'
          setDragColumnName(null)
          setDropTargetColumnName(null)
          setDropSide('left')
          return
        }
        setSelectionAnchor(null)
        setSelectionFocus(null)
        setRowSelection((prev) => (prev.kind === 'none' ? prev : ROW_SELECTION_NONE))
        setIsColumnSelection(false)
        lastCheckboxRowRef.current = null
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault()
        const rws = rowsRef.current
        const currentCols = columnsRef.current
        if (rws.length > 0 && currentCols.length > 0) {
          suppressFocusScrollRef.current = true
          setEditingCell(null)
          setRowSelection((prev) => (prev.kind === 'none' ? prev : ROW_SELECTION_NONE))
          lastCheckboxRowRef.current = null
          setSelectionAnchor({ rowIndex: 0, colIndex: 0 })
          setSelectionFocus({
            rowIndex: rws.length - 1,
            colIndex: currentCols.length - 1,
          })
          setIsColumnSelection(false)
        }
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === ' ') {
        const a = selectionAnchorRef.current
        if (!a || editingCellRef.current) return
        const lastRow = rowsRef.current.length - 1
        if (lastRow < 0) return
        e.preventDefault()
        setRowSelection((prev) => (prev.kind === 'none' ? prev : ROW_SELECTION_NONE))
        lastCheckboxRowRef.current = null
        setSelectionAnchor({ rowIndex: 0, colIndex: a.colIndex })
        setSelectionFocus({ rowIndex: lastRow, colIndex: a.colIndex })
        setIsColumnSelection(true)
        return
      }

      if (e.key === ' ' && e.shiftKey) {
        const a = selectionAnchorRef.current
        if (!a || editingCellRef.current) return
        const currentCols = columnsRef.current
        if (currentCols.length === 0) return
        e.preventDefault()
        setRowSelection((prev) => (prev.kind === 'none' ? prev : ROW_SELECTION_NONE))
        lastCheckboxRowRef.current = null
        setIsColumnSelection(false)
        setSelectionAnchor({ rowIndex: a.rowIndex, colIndex: 0 })
        setSelectionFocus({ rowIndex: a.rowIndex, colIndex: currentCols.length - 1 })
        return
      }

      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        !rowSelectionIsEmpty(rowSelectionRef.current)
      ) {
        if (editingCellRef.current) return
        if (!canEditRef.current) return
        e.preventDefault()
        const rowSel = rowSelectionRef.current
        void (async () => {
          const allRows = await ensureAllRowsLoadedRef.current()
          const currentCols = columnsRef.current
          const undoCells: Array<{ rowId: string; data: Record<string, unknown> }> = []
          const batchUpdates: Array<{ rowId: string; data: Record<string, unknown> }> = []
          for (const row of allRows) {
            if (!rowSelectionIncludes(rowSel, row.id)) continue
            const updates: Record<string, unknown> = {}
            const previousData: Record<string, unknown> = {}
            for (const col of currentCols) {
              previousData[col.name] = row.data[col.name] ?? null
              updates[col.name] = null
            }
            undoCells.push({ rowId: row.id, data: previousData })
            batchUpdates.push({ rowId: row.id, data: updates })
          }
          if (undoCells.length > 0) {
            pushUndoRef.current({ type: 'clear-cells', cells: undoCells })
          }
          await chunkBatchUpdates(batchUpdates, batchUpdateAsyncRef.current)
        })().catch((error) => {
          logger.error('Failed to clear selected cells', { error })
          toast.error('Failed to clear cells — please try again')
        })
        return
      }

      const anchor = selectionAnchorRef.current
      if (!anchor || editingCellRef.current) return

      const cols = columnsRef.current
      const currentRows = rowsRef.current
      const totalRows = currentRows.length

      if (e.shiftKey && e.key === 'Enter') {
        if (!canEditRef.current) return
        const row = currentRows[anchor.rowIndex]
        if (!row) return
        e.preventDefault()
        const position = row.position + 1
        const colIndex = anchor.colIndex
        createRef.current(
          { data: {}, position },
          {
            onSuccess: (response: Record<string, unknown>) => {
              const newRowId = extractCreatedRowId(response)
              if (newRowId) {
                pushUndoRef.current({ type: 'create-row', rowId: newRowId, position })
              }
              setSelectionAnchor({ rowIndex: anchor.rowIndex + 1, colIndex })
              setSelectionFocus(null)
            },
          }
        )
        return
      }

      if (e.key === 'Enter' || e.key === 'F2') {
        if (!canEditRef.current) return
        e.preventDefault()
        const col = cols[anchor.colIndex]
        if (!col) return

        const row = currentRows[anchor.rowIndex]
        if (!row) return

        if (col.type === 'boolean') {
          toggleBooleanCellRef.current(row.id, col.name, row.data[col.name])
          return
        }
        setEditingCell({ rowId: row.id, columnName: col.name })
        setInitialCharacter(null)
        return
      }

      if (e.key === ' ' && !e.shiftKey) {
        if (!canEditRef.current) return
        e.preventDefault()
        const row = currentRows[anchor.rowIndex]
        if (row) {
          onOpenRowModalRef.current(row)
        }
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        setRowSelection((prev) => (prev.kind === 'none' ? prev : ROW_SELECTION_NONE))
        setIsColumnSelection(false)
        lastCheckboxRowRef.current = null
        setSelectionAnchor(moveCell(anchor, cols.length, totalRows, e.shiftKey ? -1 : 1))
        setSelectionFocus(null)
        return
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        setRowSelection((prev) => (prev.kind === 'none' ? prev : ROW_SELECTION_NONE))
        setIsColumnSelection(false)
        lastCheckboxRowRef.current = null
        const focus = selectionFocusRef.current ?? anchor
        const origin = e.shiftKey ? focus : anchor
        const jump = e.metaKey || e.ctrlKey
        let newRow = origin.rowIndex
        let newCol = origin.colIndex

        switch (e.key) {
          case 'ArrowUp':
            newRow = jump ? 0 : Math.max(0, newRow - 1)
            break
          case 'ArrowDown':
            newRow = jump ? totalRows - 1 : Math.min(totalRows - 1, newRow + 1)
            break
          case 'ArrowLeft':
            newCol = jump ? 0 : Math.max(0, newCol - 1)
            break
          case 'ArrowRight':
            newCol = jump ? cols.length - 1 : Math.min(cols.length - 1, newCol + 1)
            break
        }

        if (e.shiftKey) {
          setSelectionFocus({ rowIndex: newRow, colIndex: newCol })
        } else {
          setSelectionAnchor({ rowIndex: newRow, colIndex: newCol })
          setSelectionFocus(null)
        }
        return
      }

      if (e.key === 'Home') {
        e.preventDefault()
        setIsColumnSelection(false)
        const jump = e.metaKey || e.ctrlKey
        if (e.shiftKey) {
          const focus = selectionFocusRef.current ?? anchor
          setSelectionFocus({ rowIndex: jump ? 0 : focus.rowIndex, colIndex: 0 })
        } else {
          setSelectionAnchor({ rowIndex: jump ? 0 : anchor.rowIndex, colIndex: 0 })
          setSelectionFocus(null)
        }
        return
      }

      if (e.key === 'End') {
        e.preventDefault()
        setIsColumnSelection(false)
        const jump = e.metaKey || e.ctrlKey
        if (e.shiftKey) {
          const focus = selectionFocusRef.current ?? anchor
          setSelectionFocus({
            rowIndex: jump ? totalRows - 1 : focus.rowIndex,
            colIndex: cols.length - 1,
          })
        } else {
          setSelectionAnchor({
            rowIndex: jump ? totalRows - 1 : anchor.rowIndex,
            colIndex: cols.length - 1,
          })
          setSelectionFocus(null)
        }
        return
      }

      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault()
        setIsColumnSelection(false)
        const scrollEl = scrollRef.current
        const viewportHeight = scrollEl ? scrollEl.clientHeight : ROW_HEIGHT_ESTIMATE * 10
        const rowsPerPage = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT_ESTIMATE))
        const direction = e.key === 'PageUp' ? -1 : 1
        const origin = e.shiftKey ? (selectionFocusRef.current ?? anchor) : anchor
        const newRow = Math.max(
          0,
          Math.min(totalRows - 1, origin.rowIndex + direction * rowsPerPage)
        )
        if (e.shiftKey) {
          setSelectionFocus({ rowIndex: newRow, colIndex: origin.colIndex })
        } else {
          setSelectionAnchor({ rowIndex: newRow, colIndex: anchor.colIndex })
          setSelectionFocus(null)
        }
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault()
        if (!canEditRef.current) return
        const sel = computeNormalizedSelection(anchor, selectionFocusRef.current)
        if (!sel || sel.startRow === sel.endRow) return
        const sourceRow = currentRows[sel.startRow]
        if (!sourceRow) return
        const undoCells: Array<{
          rowId: string
          oldData: Record<string, unknown>
          newData: Record<string, unknown>
        }> = []
        for (let r = sel.startRow + 1; r <= sel.endRow; r++) {
          const row = currentRows[r]
          if (!row) continue
          const oldData: Record<string, unknown> = {}
          const newData: Record<string, unknown> = {}
          for (let c = sel.startCol; c <= sel.endCol; c++) {
            if (c < cols.length) {
              const colName = cols[c].name
              oldData[colName] = row.data[colName] ?? null
              newData[colName] = sourceRow.data[colName] ?? null
            }
          }
          undoCells.push({ rowId: row.id, oldData, newData })
        }
        if (undoCells.length > 0) {
          batchUpdateRef.current({
            updates: undoCells.map((c) => ({ rowId: c.rowId, data: c.newData })),
          })
          pushUndoRef.current({ type: 'update-cells', cells: undoCells })
        }
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!canEditRef.current) return
        e.preventDefault()
        const sel = computeNormalizedSelection(anchor, selectionFocusRef.current)
        if (!sel) return

        if (isColumnSelectionRef.current) {
          // Column-header selection spans all rows — selection bounds are capped
          // to the loaded page count, so drain first then walk the full set.
          void (async () => {
            const allRows = await ensureAllRowsLoadedRef.current()
            const undoCells: Array<{ rowId: string; data: Record<string, unknown> }> = []
            const batchUpdates: Array<{ rowId: string; data: Record<string, unknown> }> = []
            for (const row of allRows) {
              const updates: Record<string, unknown> = {}
              const previousData: Record<string, unknown> = {}
              for (let c = sel.startCol; c <= sel.endCol; c++) {
                const colName = cols[c]?.name
                if (!colName) continue
                previousData[colName] = row.data[colName] ?? null
                updates[colName] = null
              }
              undoCells.push({ rowId: row.id, data: previousData })
              batchUpdates.push({ rowId: row.id, data: updates })
            }
            if (undoCells.length > 0) pushUndoRef.current({ type: 'clear-cells', cells: undoCells })
            await chunkBatchUpdates(batchUpdates, batchUpdateAsyncRef.current)
          })().catch((error) => {
            logger.error('Failed to clear column values', { error })
            toast.error('Failed to clear column values — please try again')
          })
          return
        }

        const undoCells: Array<{ rowId: string; data: Record<string, unknown> }> = []
        const batchUpdates: Array<{ rowId: string; data: Record<string, unknown> }> = []
        for (let r = sel.startRow; r <= sel.endRow; r++) {
          const row = currentRows[r]
          if (!row) continue
          const updates: Record<string, unknown> = {}
          const previousData: Record<string, unknown> = {}
          for (let c = sel.startCol; c <= sel.endCol; c++) {
            if (c < cols.length) {
              const colName = cols[c].name
              previousData[colName] = row.data[colName] ?? null
              updates[colName] = null
            }
          }
          undoCells.push({ rowId: row.id, data: previousData })
          batchUpdates.push({ rowId: row.id, data: updates })
        }
        void chunkBatchUpdates(batchUpdates, batchUpdateAsyncRef.current).catch((error) => {
          logger.error('Failed to clear selected cells', { error })
          toast.error('Failed to clear cells — please try again')
        })
        if (undoCells.length > 0) {
          pushUndoRef.current({ type: 'clear-cells', cells: undoCells })
        }
        return
      }

      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!canEditRef.current) return
        const col = cols[anchor.colIndex]
        // Workflow-output cells are editable: the user can override the
        // workflow's value if they want. Booleans toggle on space/click —
        // typeahead doesn't apply to them.
        if (!col || col.type === 'boolean') return
        if (col.type === 'number' && !/[\d.-]/.test(e.key)) return
        if (col.type === 'date' && !/[\d\-/]/.test(e.key)) return
        e.preventDefault()

        const row = currentRows[anchor.rowIndex]
        if (!row) return
        setEditingCell({ rowId: row.id, columnName: col.name })
        setInitialCharacter(e.key)
        return
      }
    }

    const handleCopy = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (editingCellRef.current) return

      const rowSel = rowSelectionRef.current
      const cols = columnsRef.current
      const currentRows = rowsRef.current

      if (!rowSelectionIsEmpty(rowSel)) {
        e.preventDefault()
        void (async () => {
          const allRows = await ensureAllRowsLoadedRef.current()
          const lines: string[] = []
          for (const row of allRows) {
            if (!rowSelectionIncludes(rowSel, row.id)) continue
            const cells: string[] = cols.map((col) => {
              const value: unknown = row.data[col.name]
              if (value === null || value === undefined) return ''
              return typeof value === 'object' ? JSON.stringify(value) : String(value)
            })
            lines.push(cells.join('\t'))
          }
          if (!navigator.clipboard) {
            toast.error('Clipboard access is unavailable in this context')
            return
          }
          try {
            await navigator.clipboard.writeText(lines.join('\n'))
          } catch (err) {
            if (err instanceof DOMException && err.name === 'NotAllowedError') {
              toast.error(
                'Clipboard permission expired — press Cmd+C again immediately after selecting'
              )
            } else {
              throw err
            }
          }
        })().catch((error) => {
          logger.error('Failed to copy selected rows', { error })
          toast.error('Failed to copy — please try again')
        })
        return
      }

      const anchor = selectionAnchorRef.current
      if (!anchor) return

      const sel = computeNormalizedSelection(anchor, selectionFocusRef.current)
      if (!sel) return

      e.preventDefault()

      if (isColumnSelectionRef.current) {
        // Column-header copy spans all rows — drain pages first, then use async
        // clipboard so we don't block the event before the drain completes.
        void (async () => {
          const allRows = await ensureAllRowsLoadedRef.current()
          const lines: string[] = []
          for (const row of allRows) {
            const cells: string[] = []
            for (let c = sel.startCol; c <= sel.endCol; c++) {
              const colName = cols[c]?.name
              if (!colName) continue
              const value: unknown = row.data[colName]
              cells.push(
                value === null || value === undefined
                  ? ''
                  : typeof value === 'object'
                    ? JSON.stringify(value)
                    : String(value)
              )
            }
            lines.push(cells.join('\t'))
          }
          if (!navigator.clipboard) {
            toast.error('Clipboard access is unavailable in this context')
            return
          }
          try {
            await navigator.clipboard.writeText(lines.join('\n'))
          } catch (err) {
            if (err instanceof DOMException && err.name === 'NotAllowedError') {
              toast.error(
                'Clipboard permission expired — press Cmd+C again immediately after selecting'
              )
            } else {
              throw err
            }
          }
        })().catch((error) => {
          logger.error('Failed to copy column cells', { error })
          toast.error('Failed to copy — please try again')
        })
        return
      }

      const lines: string[] = []
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        const cells: string[] = []
        for (let c = sel.startCol; c <= sel.endCol; c++) {
          if (c >= cols.length) break
          const row = currentRows[r]
          const value: unknown = row ? row.data[cols[c].name] : null
          if (value === null || value === undefined) {
            cells.push('')
          } else {
            cells.push(typeof value === 'object' ? JSON.stringify(value) : String(value))
          }
        }
        lines.push(cells.join('\t'))
      }
      e.clipboardData?.setData('text/plain', lines.join('\n'))
    }

    const handleCut = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (editingCellRef.current) return
      if (!canEditRef.current) return

      const rowSel = rowSelectionRef.current
      const cols = columnsRef.current
      const currentRows = rowsRef.current

      if (!rowSelectionIsEmpty(rowSel)) {
        e.preventDefault()
        void (async () => {
          const allRows = await ensureAllRowsLoadedRef.current()
          const lines: string[] = []
          const cutUpdates: Array<{ rowId: string; data: Record<string, unknown> }> = []
          const cutUndo: Array<{ rowId: string; data: Record<string, unknown> }> = []
          for (const row of allRows) {
            if (!rowSelectionIncludes(rowSel, row.id)) continue
            const cells: string[] = cols.map((col) => {
              const value: unknown = row.data[col.name]
              if (value === null || value === undefined) return ''
              return typeof value === 'object' ? JSON.stringify(value) : String(value)
            })
            lines.push(cells.join('\t'))
            const updates: Record<string, unknown> = {}
            const previousData: Record<string, unknown> = {}
            for (const col of cols) {
              previousData[col.name] = row.data[col.name] ?? null
              updates[col.name] = null
            }
            cutUndo.push({ rowId: row.id, data: previousData })
            cutUpdates.push({ rowId: row.id, data: updates })
          }
          if (!navigator.clipboard) {
            toast.error('Clipboard access is unavailable in this context')
            return
          }
          try {
            await navigator.clipboard.writeText(lines.join('\n'))
          } catch (err) {
            if (err instanceof DOMException && err.name === 'NotAllowedError') {
              toast.error(
                'Clipboard permission expired — press Cmd+X again immediately after selecting'
              )
              return
            }
            throw err
          }
          if (cutUndo.length > 0) {
            pushUndoRef.current({ type: 'clear-cells', cells: cutUndo })
          }
          if (cutUpdates.length > 0) {
            await chunkBatchUpdates(cutUpdates, batchUpdateAsyncRef.current)
          }
        })().catch((error) => {
          logger.error('Failed to cut selected rows', { error })
          toast.error('Failed to cut — please try again')
        })
        return
      }

      const anchor = selectionAnchorRef.current
      if (!anchor) return

      const sel = computeNormalizedSelection(anchor, selectionFocusRef.current)
      if (!sel) return

      e.preventDefault()

      if (isColumnSelectionRef.current) {
        // Column-header cut spans all rows — drain pages first, then use async
        // clipboard so we don't block the event before the drain completes.
        void (async () => {
          const allRows = await ensureAllRowsLoadedRef.current()
          const lines: string[] = []
          const undoCells: Array<{ rowId: string; data: Record<string, unknown> }> = []
          const batchUpdates: Array<{ rowId: string; data: Record<string, unknown> }> = []
          for (const row of allRows) {
            const cells: string[] = []
            const updates: Record<string, unknown> = {}
            const previousData: Record<string, unknown> = {}
            for (let c = sel.startCol; c <= sel.endCol; c++) {
              const colName = cols[c]?.name
              if (!colName) continue
              const value: unknown = row.data[colName]
              cells.push(
                value === null || value === undefined
                  ? ''
                  : typeof value === 'object'
                    ? JSON.stringify(value)
                    : String(value)
              )
              previousData[colName] = row.data[colName] ?? null
              updates[colName] = null
            }
            lines.push(cells.join('\t'))
            undoCells.push({ rowId: row.id, data: previousData })
            batchUpdates.push({ rowId: row.id, data: updates })
          }
          if (!navigator.clipboard) {
            toast.error('Clipboard access is unavailable in this context')
            return
          }
          try {
            await navigator.clipboard.writeText(lines.join('\n'))
          } catch (err) {
            if (err instanceof DOMException && err.name === 'NotAllowedError') {
              toast.error(
                'Clipboard permission expired — press Cmd+X again immediately after selecting'
              )
              return
            }
            throw err
          }
          if (undoCells.length > 0) {
            pushUndoRef.current({ type: 'clear-cells', cells: undoCells })
          }
          await chunkBatchUpdates(batchUpdates, batchUpdateAsyncRef.current)
        })().catch((error) => {
          logger.error('Failed to cut column cells', { error })
          toast.error('Failed to cut — please try again')
        })
        return
      }

      const lines: string[] = []
      const undoCells: Array<{ rowId: string; data: Record<string, unknown> }> = []
      const batchUpdates: Array<{ rowId: string; data: Record<string, unknown> }> = []
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        const row = currentRows[r]
        if (!row) continue
        const cells: string[] = []
        const updates: Record<string, unknown> = {}
        const previousData: Record<string, unknown> = {}
        for (let c = sel.startCol; c <= sel.endCol; c++) {
          if (c < cols.length) {
            const colName = cols[c].name
            const value: unknown = row.data[colName]
            if (value === null || value === undefined) {
              cells.push('')
            } else {
              cells.push(typeof value === 'object' ? JSON.stringify(value) : String(value))
            }
            previousData[colName] = row.data[colName] ?? null
            updates[colName] = null
          }
        }
        lines.push(cells.join('\t'))
        undoCells.push({ rowId: row.id, data: previousData })
        batchUpdates.push({ rowId: row.id, data: updates })
      }
      e.clipboardData?.setData('text/plain', lines.join('\n'))
      void chunkBatchUpdates(batchUpdates, batchUpdateAsyncRef.current).catch((error) => {
        logger.error('Failed to cut selected cells', { error })
        toast.error('Failed to cut — please try again')
      })
      if (undoCells.length > 0) {
        pushUndoRef.current({ type: 'clear-cells', cells: undoCells })
      }
    }

    const handlePaste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (!canEditRef.current) return

      const currentAnchor = selectionAnchorRef.current
      if (!currentAnchor || editingCellRef.current) return

      e.preventDefault()
      const text = e.clipboardData?.getData('text/plain')
      if (!text) return

      const pasteRows = text
        .split(/\r?\n/)
        .filter((line, idx, arr) => !(idx === arr.length - 1 && line === ''))
        .map((line) => line.split('\t'))

      if (pasteRows.length === 0) return

      const currentCols = columnsRef.current
      const currentRows = rowsRef.current
      // Captured once before the loop so each new row in the batch gets a unique,
      // sequential position via `+ (newRowIndex - currentRows.length)` below.
      const lastRowPosition = currentRows.reduce((max, r) => Math.max(max, r.position), -1)

      const undoCells: Array<{ rowId: string; data: Record<string, unknown> }> = []
      const updateBatch: Array<{ rowId: string; data: Record<string, unknown> }> = []
      const createBatchRows: Array<Record<string, unknown>> = []
      const createBatchPositions: number[] = []

      for (let r = 0; r < pasteRows.length; r++) {
        const targetArrayIndex = currentAnchor.rowIndex + r

        const rowData: Record<string, unknown> = {}
        for (let c = 0; c < pasteRows[r].length; c++) {
          const targetCol = currentAnchor.colIndex + c
          if (targetCol >= currentCols.length) break
          try {
            rowData[currentCols[targetCol].name] = cleanCellValue(
              pasteRows[r][c],
              currentCols[targetCol]
            )
          } catch {
            /* skip invalid values */
          }
        }

        if (Object.keys(rowData).length === 0) continue

        const existingRow = currentRows[targetArrayIndex]
        if (existingRow) {
          const previousData: Record<string, unknown> = {}
          for (const key of Object.keys(rowData)) {
            previousData[key] = existingRow.data[key] ?? null
          }
          undoCells.push({ rowId: existingRow.id, data: previousData })
          updateBatch.push({ rowId: existingRow.id, data: rowData })
        } else {
          createBatchRows.push(rowData)
          createBatchPositions.push(lastRowPosition + 1 + (targetArrayIndex - currentRows.length))
        }
      }

      if (updateBatch.length > 0) {
        batchUpdateRef.current({ updates: updateBatch })
        pushUndoRef.current({
          type: 'update-cells',
          cells: undoCells.map((cell, i) => ({
            rowId: cell.rowId,
            oldData: cell.data,
            newData: updateBatch[i].data,
          })),
        })
      }

      if (createBatchRows.length > 0) {
        batchCreateRef.current(
          { rows: createBatchRows, positions: createBatchPositions },
          {
            onSuccess: (response) => {
              const createdRows = response?.data?.rows ?? []
              const undoRows: Array<{
                rowId: string
                position: number
                data: Record<string, unknown>
              }> = []
              for (let i = 0; i < createdRows.length; i++) {
                if (createdRows[i]?.id) {
                  undoRows.push({
                    rowId: createdRows[i].id,
                    position: createBatchPositions[i],
                    data: createBatchRows[i],
                  })
                }
              }
              if (undoRows.length > 0) {
                pushUndoRef.current({ type: 'create-rows', rows: undoRows })
              }
            },
          }
        )
      }

      const maxPasteCols = Math.max(...pasteRows.map((pr) => pr.length))
      setSelectionFocus({
        rowIndex: currentAnchor.rowIndex + pasteRows.length - 1,
        colIndex: Math.min(currentAnchor.colIndex + maxPasteCols - 1, currentCols.length - 1),
      })
    }

    el.addEventListener('keydown', handleKeyDown)
    el.addEventListener('copy', handleCopy)
    el.addEventListener('cut', handleCut)
    el.addEventListener('paste', handlePaste)
    return () => {
      el.removeEventListener('keydown', handleKeyDown)
      el.removeEventListener('copy', handleCopy)
      el.removeEventListener('cut', handleCut)
      el.removeEventListener('paste', handlePaste)
    }
  }, [])

  const navigateAfterSave = useCallback((reason: SaveReason) => {
    const anchor = selectionAnchorRef.current
    if (!anchor) return
    const cols = columnsRef.current
    const totalRows = rowsRef.current.length

    if (reason === 'enter') {
      setSelectionAnchor({
        rowIndex: Math.min(totalRows - 1, anchor.rowIndex + 1),
        colIndex: anchor.colIndex,
      })
    } else if (reason === 'tab') {
      setSelectionAnchor(moveCell(anchor, cols.length, totalRows, 1))
    } else if (reason === 'shift-tab') {
      setSelectionAnchor(moveCell(anchor, cols.length, totalRows, -1))
    }
    setSelectionFocus(null)
    scrollRef.current?.focus({ preventScroll: true })
  }, [])

  const handleInlineSave = useCallback(
    (rowId: string, columnName: string, value: unknown, reason: SaveReason) => {
      const row = rowsRef.current.find((r) => r.id === rowId)
      if (!row) {
        setEditingCell(null)
        setInitialCharacter(null)
        return
      }

      const oldValue = row.data[columnName] ?? null
      const normalizedValue = value ?? null
      const changed = oldValue !== normalizedValue

      if (changed) {
        pushUndoRef.current({
          type: 'update-cell',
          rowId,
          columnName,
          previousValue: oldValue,
          newValue: value,
        })
        mutateRef.current({ rowId, data: { [columnName]: value } })
      }

      setEditingCell(null)
      setInitialCharacter(null)
      navigateAfterSave(reason)
    },
    [navigateAfterSave]
  )

  const handleInlineCancel = useCallback(() => {
    setEditingCell(null)
    setInitialCharacter(null)
    scrollRef.current?.focus({ preventScroll: true })
  }, [])

  const generateColumnName = useCallback(
    () => sharedGenerateColumnName(schemaColumnsRef.current),
    []
  )

  const handleChangeType = useCallback((columnName: string, newType: ColumnDefinition['type']) => {
    const column = columnsRef.current.find((c) => c.name === columnName)
    const previousType = column?.type
    updateColumnMutation.mutate(
      { columnName, updates: { type: newType } },
      {
        onSuccess: () => {
          if (previousType) {
            pushUndoRef.current({
              type: 'update-column-type',
              columnName,
              previousType,
              newType,
            })
          }
        },
      }
    )
  }, [])

  const insertColumnInOrder = useCallback(
    (anchorColumn: string, newColumn: string, side: 'left' | 'right') => {
      const order = columnOrderRef.current ?? schemaColumnsRef.current.map((c) => c.name)
      const newOrder = [...order]
      let anchorIdx = newOrder.indexOf(anchorColumn)
      if (anchorIdx === -1) {
        newOrder.push(anchorColumn)
        anchorIdx = newOrder.length - 1
      }
      const insertIdx = anchorIdx + (side === 'right' ? 1 : 0)
      newOrder.splice(insertIdx, 0, newColumn)
      setColumnOrder(newOrder)
      updateMetadataRef.current({
        columnWidths: columnWidthsRef.current,
        columnOrder: newOrder,
      })
    },
    []
  )

  const handleInsertColumnLeft = useCallback(
    (columnName: string) => {
      const index = schemaColumnsRef.current.findIndex((c) => c.name === columnName)
      if (index === -1) return
      const name = generateColumnName()
      addColumnMutation.mutate(
        { name, type: 'string', position: index },
        {
          onSuccess: () => {
            pushUndoRef.current({ type: 'create-column', columnName: name, position: index })
            insertColumnInOrder(columnName, name, 'left')
          },
        }
      )
    },
    [generateColumnName, insertColumnInOrder]
  )

  const handleInsertColumnRight = useCallback(
    (columnName: string) => {
      const index = schemaColumnsRef.current.findIndex((c) => c.name === columnName)
      if (index === -1) return
      const name = generateColumnName()
      const position = index + 1
      addColumnMutation.mutate(
        { name, type: 'string', position },
        {
          onSuccess: () => {
            pushUndoRef.current({ type: 'create-column', columnName: name, position })
            insertColumnInOrder(columnName, name, 'right')
          },
        }
      )
    },
    [generateColumnName, insertColumnInOrder]
  )

  /**
   * Open the column-config sidebar pre-seeded with the chosen scalar type.
   * Nothing is persisted until the user fills in the name and hits Save.
   */
  function handleAddColumnOfType(type: ColumnDefinition['type']) {
    onOpenColumnConfig({ mode: 'create', proposedName: generateColumnName(), type })
  }

  /** Open the workflow-config sidebar to spawn a brand-new workflow group. */
  function handleAddWorkflowColumn() {
    onOpenWorkflowConfig({ mode: 'create', proposedName: generateColumnName() })
  }

  const handleConfigureColumn = useCallback(
    (columnName: string) => {
      const column = columnsRef.current.find((c) => c.name === columnName)
      if (column?.workflowGroupId) {
        // Workflow-output column header → single-output sub-mode.
        onOpenWorkflowConfig({ mode: 'edit-output', columnName })
      } else {
        onOpenColumnConfig({ mode: 'edit', columnName })
      }
    },
    [onOpenColumnConfig, onOpenWorkflowConfig]
  )

  const handleConfigureWorkflowGroup = useCallback(
    (groupId: string) => {
      onOpenWorkflowConfig({ mode: 'edit-group', groupId })
    },
    [onOpenWorkflowConfig]
  )

  const handleDeleteWorkflowGroup = useCallback((groupId: string) => {
    deleteWorkflowGroupRef.current({ groupId })
  }, [])

  /**
   * Computes the names slated for deletion given a click on `columnName` and
   * the current column selection. If the click landed inside a multi-column
   * selection, the entire selection is the target; otherwise it's just the
   * clicked column.
   */
  const resolveDeletionNames = useCallback((columnName: string): string[] => {
    const cols = columnsRef.current
    if (isColumnSelectionRef.current && selectionAnchorRef.current) {
      const sel = computeNormalizedSelection(selectionAnchorRef.current, selectionFocusRef.current)
      if (sel && sel.startCol !== sel.endCol) {
        const clickedIdx = cols.findIndex((c) => c.name === columnName)
        if (clickedIdx >= sel.startCol && clickedIdx <= sel.endCol) {
          const names: string[] = []
          for (let c = sel.startCol; c <= sel.endCol; c++) {
            if (c < cols.length) names.push(cols[c].name)
          }
          if (names.length > 0) return names
        }
      }
    }
    return [columnName]
  }, [])

  /**
   * Hide a workflow-output column by removing it from its group's `outputs`
   * via `updateWorkflowGroup`. Server-side this drops the schema column AND
   * wipes the cell data on every row. The user can re-add the output from
   * the sidebar's picker; the existing backfill repopulates from execution
   * logs. Only valid when removing the columns leaves every affected group
   * with at least one surviving output — caller must check first.
   */
  const hideWorkflowOutputColumns = useCallback((names: string[]) => {
    const schemaCols = schemaColumnsRef.current
    const groups = workflowGroupsRef.current
    const removalsByGroup = new Map<string, Set<string>>()
    for (const name of names) {
      const def = schemaCols.find((c) => c.name === name)
      if (!def?.workflowGroupId) return false
      const set = removalsByGroup.get(def.workflowGroupId) ?? new Set<string>()
      set.add(name)
      removalsByGroup.set(def.workflowGroupId, set)
    }
    for (const [groupId, removed] of removalsByGroup) {
      const group = groups.find((g) => g.id === groupId)
      if (!group) return false
      const remaining = group.outputs.filter((o) => !removed.has(o.columnName))
      if (remaining.length === 0) return false
      updateWorkflowGroupRef.current({
        groupId: group.id,
        workflowId: group.workflowId,
        name: group.name,
        dependencies: group.dependencies,
        outputs: remaining,
      })
    }
    return true
  }, [])

  const handleDeleteColumn = useCallback(
    (columnName: string) => {
      const names = resolveDeletionNames(columnName)
      // If every target is a workflow output AND removing them all leaves each
      // group with ≥1 output, hide them directly — no destructive-confirm
      // modal, since the workflow can re-produce the value any time.
      if (hideWorkflowOutputColumns(names)) return
      onRequestDeleteColumns(names)
    },
    [resolveDeletionNames, hideWorkflowOutputColumns, onRequestDeleteColumns]
  )

  // Populated as a sink so the wrapper's delete-columns modal can run the
  // full cascade (per-column mutation + undo + columnOrder/columnWidths
  // cleanup) without lifting any of that grid-internal state.
  confirmDeleteColumnsSinkRef.current = (names: string[]) => {
    if (!names || names.length === 0) return
    const columnsToDelete = [...names]

    let currentOrder = columnOrderRef.current ? [...columnOrderRef.current] : null
    const cols = schemaColumnsRef.current
    const originalPositions = new Map<
      string,
      { position: number; def: (typeof cols)[number] | undefined }
    >()
    for (const name of columnsToDelete) {
      const def = cols.find((c) => c.name === name)
      originalPositions.set(name, { position: def ? cols.indexOf(def) : cols.length, def })
    }
    const deletedOriginalPositions: number[] = []

    const deleteNext = (index: number) => {
      if (index >= columnsToDelete.length) return
      const columnToDelete = columnsToDelete[index]
      const entry = originalPositions.get(columnToDelete)!
      const adjustedPosition =
        entry.position - deletedOriginalPositions.filter((p) => p < entry.position).length
      const currentRows = rowsRef.current
      const cellData = currentRows
        .filter((r) => r.data[columnToDelete] != null)
        .map((r) => ({ rowId: r.id, value: r.data[columnToDelete] }))
      const previousWidth = columnWidthsRef.current[columnToDelete] ?? null
      const orderSnapshot = currentOrder ? [...currentOrder] : null

      const onDeleted = () => {
        deletedOriginalPositions.push(entry.position)
        pushUndoRef.current({
          type: 'delete-column',
          columnName: columnToDelete,
          columnType: entry.def?.type ?? 'string',
          columnPosition: adjustedPosition >= 0 ? adjustedPosition : cols.length,
          columnUnique: entry.def?.unique ?? false,
          columnRequired: entry.def?.required ?? false,
          cellData,
          previousOrder: orderSnapshot,
          previousWidth,
        })

        const { [columnToDelete]: _removedWidth, ...cleanedWidths } = columnWidthsRef.current
        setColumnWidths(cleanedWidths)
        columnWidthsRef.current = cleanedWidths

        if (currentOrder) {
          currentOrder = currentOrder.filter((n) => n !== columnToDelete)
          setColumnOrder(currentOrder)
          updateMetadataRef.current({
            columnWidths: cleanedWidths,
            columnOrder: currentOrder,
          })
        } else {
          updateMetadataRef.current({ columnWidths: cleanedWidths })
        }

        deleteNext(index + 1)
      }

      // Workflow-output columns are owned by a group: route the delete through
      // `updateWorkflowGroup` so the same code path fires whether the user
      // deselects the output in the sidebar or right-clicks Delete column.
      // Falls back to deleting the whole group when this is its last output,
      // since a group with zero outputs is invalid.
      const groupId = entry.def?.workflowGroupId
      const group = groupId ? workflowGroupsRef.current.find((g) => g.id === groupId) : undefined
      if (group) {
        const remainingOutputs = group.outputs.filter((o) => o.columnName !== columnToDelete)
        if (remainingOutputs.length === 0) {
          deleteWorkflowGroupMutation.mutate({ groupId: group.id }, { onSuccess: onDeleted })
        } else {
          updateWorkflowGroupMutation.mutate(
            {
              groupId: group.id,
              workflowId: group.workflowId,
              name: group.name,
              dependencies: group.dependencies,
              outputs: remainingOutputs,
            },
            { onSuccess: onDeleted }
          )
        }
        return
      }

      deleteColumnMutation.mutate(columnToDelete, { onSuccess: onDeleted })
    }

    setSelectionAnchor(null)
    setSelectionFocus(null)
    setIsColumnSelection(false)
    deleteNext(0)
  }

  /**
   * Row ids the context menu acts on. If the right-clicked row is part of the
   * gutter row selection, the materialized selection; if it's inside the active
   * range selection, the range; otherwise just the row itself. Used by both the
   * count label and the multi-row "Run workflows" action.
   */
  const contextMenuRowIds = useMemo<string[]>(() => {
    if (!contextMenu.isOpen || !contextMenu.row) return []
    if (
      !rowSelectionIsEmpty(rowSelection) &&
      rowSelectionIncludes(rowSelection, contextMenu.row.id)
    ) {
      const ids: string[] = []
      for (const row of rows) {
        if (rowSelectionIncludes(rowSelection, row.id)) ids.push(row.id)
      }
      return ids.length > 0 ? ids : [contextMenu.row.id]
    }
    const sel = normalizedSelection
    if (sel) {
      const contextRowArrayIndex = rows.findIndex((r) => r.id === contextMenu.row!.id)
      const isInSelection =
        contextRowArrayIndex >= sel.startRow && contextRowArrayIndex <= sel.endRow
      if (isInSelection) {
        const ids: string[] = []
        const start = Math.max(0, sel.startRow)
        const end = Math.min(rows.length - 1, sel.endRow)
        for (let r = start; r <= end; r++) {
          const row = rows[r]
          if (row) ids.push(row.id)
        }
        return ids.length > 0 ? ids : [contextMenu.row.id]
      }
    }
    return [contextMenu.row.id]
  }, [contextMenu.isOpen, contextMenu.row, rowSelection, normalizedSelection, rows])

  const selectedRowCount = contextMenuRowIds.length || 1

  const pendingUpdate = updateRowMutation.isPending ? updateRowMutation.variables : null

  /**
   * Row ids for the current multi-row selection. Drives "Run N selected rows"
   * in the workflow-group run menu — `null` when there's no multi-selection so
   * the menu collapses to "Run all rows".
   */
  const selectedRowIds = useMemo<string[] | null>(() => {
    if (rowSelectionIsEmpty(rowSelection)) return null
    const ids: string[] = []
    for (const row of rows) {
      if (rowSelectionIncludes(rowSelection, row.id)) ids.push(row.id)
    }
    return ids.length > 0 ? ids : null
  }, [rowSelection, rows])

  const { runningByRowId, totalRunning } = useMemo(() => {
    const byRow = new Map<string, number>()
    let total = 0
    for (const row of rows) {
      let count = 0
      const executions = row.executions ?? {}
      for (const gid in executions) {
        if (isExecInFlight(executions[gid])) count++
      }
      if (count > 0) {
        byRow.set(row.id, count)
        total += count
      }
    }
    return { runningByRowId: byRow, totalRunning: total }
  }, [rows])

  // Context-menu wrappers: act on `contextMenuRowIds`, then close the menu.
  // Mirror the action bar's Play / Refresh split: Play fills empty/failed,
  // Refresh re-runs everything (including completed cells).
  const handleRunWorkflowsOnSelection = () => {
    onRunRows(contextMenuRowIds, 'incomplete')
    closeContextMenu()
  }
  const handleRefreshWorkflowsOnSelection = () => {
    onRunRows(contextMenuRowIds, 'all')
    closeContextMenu()
  }
  const handleStopWorkflowsOnSelection = () => {
    onStopRows(contextMenuRowIds)
    closeContextMenu()
  }

  // Total running/queued cells across the rows the context menu is acting on;
  // drives the "Stop N running workflows" item, shown only when > 0.
  const runningInContextSelection = contextMenuRowIds.reduce(
    (total, rowId) => total + (runningByRowId.get(rowId) ?? 0),
    0
  )

  // Action-bar selection covers both gutter row-selection AND multi-row
  // range selection (clicking + dragging across rows), matching how the
  // right-click context menu treats them. Single-row range doesn't trigger
  // the bar — only multi-row, since the per-row gutter button already covers
  // that case. Gutter selection wins when both exist.
  const actionBarRowIds = useMemo<string[]>(() => {
    if (!rowSelectionIsEmpty(rowSelection)) {
      const ids: string[] = []
      for (const row of rows) {
        if (rowSelectionIncludes(rowSelection, row.id)) ids.push(row.id)
      }
      return ids
    }
    const sel = normalizedSelection
    if (sel && sel.endRow > sel.startRow) {
      const ids: string[] = []
      const start = Math.max(0, sel.startRow)
      const end = Math.min(rows.length - 1, sel.endRow)
      for (let r = start; r <= end; r++) {
        const row = rows[r]
        if (row) ids.push(row.id)
      }
      return ids
    }
    return []
  }, [rowSelection, normalizedSelection, rows])
  const runningInActionBarSelection = actionBarRowIds.reduce(
    (total, rowId) => total + (runningByRowId.get(rowId) ?? 0),
    0
  )

  /**
   * Selection that resolves to exactly one workflow-group execution — same
   * row, every highlighted column belonging to the same workflow group. Drives
   * the action bar's per-execution mode (View execution / Run cell / Stop
   * cell). Includes the single-cell case (1×1) and the "highlight a row's
   * workflow outputs" case (1 row × N cols, all in one group). Null for
   * multi-row selections, plain columns, or no selection.
   */
  const singleWorkflowCell = useMemo<SelectionSnapshot['singleWorkflowCell']>(() => {
    const sel = normalizedSelection
    if (!sel) return null
    if (sel.startRow !== sel.endRow) return null
    const row = rows[sel.startRow]
    if (!row) return null
    const firstCol = displayColumns[sel.startCol]
    const groupId = firstCol?.workflowGroupId
    if (!groupId) return null
    // All columns in the highlight must be in the same workflow group, else
    // we'd be straddling two executions.
    for (let c = sel.startCol + 1; c <= sel.endCol; c++) {
      if (displayColumns[c]?.workflowGroupId !== groupId) return null
    }
    const exec = row.executions?.[groupId]
    const status = exec?.status
    return {
      rowId: row.id,
      groupId,
      executionId: exec?.executionId ?? null,
      canViewExecution: status === 'completed' || status === 'error' || status === 'running',
    }
  }, [normalizedSelection, rows, displayColumns])

  const tableWorkflowGroupIds = useMemo(
    () => tableWorkflowGroups.map((g) => g.id),
    [tableWorkflowGroups]
  )

  // Drives Run vs Refresh visibility on the context menu — same classifier
  // the action bar uses, so both surfaces stay in sync.
  const contextMenuStats = useMemo(
    () => classifyExecStatusMix(rows, new Set(contextMenuRowIds), tableWorkflowGroupIds),
    [contextMenuRowIds, rows, tableWorkflowGroupIds]
  )

  // Run scope is derived from one of two selection sources:
  //   - rowSelection (gutter whole-row selection) → those rows × every workflow group
  //   - normalizedSelection rectangle covering workflow-output columns →
  //     rows in the rectangle × distinct workflow groups inside it
  const selectedRunScope = useMemo<SelectionSnapshot['selectedRunScope']>(() => {
    if (tableWorkflowGroupIds.length === 0) return null
    if (!rowSelectionIsEmpty(rowSelection)) {
      if (rowSelection.kind === 'all') {
        return { groupIds: tableWorkflowGroupIds, rowIds: rows.map((r) => r.id), allRows: true }
      }
      const rowIds = rows.filter((r) => rowSelectionIncludes(rowSelection, r.id)).map((r) => r.id)
      if (rowIds.length === 0) return null
      return { groupIds: tableWorkflowGroupIds, rowIds, allRows: false }
    }
    const sel = normalizedSelection
    if (!sel) return null
    const groupIdsInRect = new Set<string>()
    for (let c = Math.max(0, sel.startCol); c <= sel.endCol; c++) {
      const gid = displayColumns[c]?.workflowGroupId
      if (gid) groupIdsInRect.add(gid)
    }
    if (groupIdsInRect.size === 0) return null
    const rowIds: string[] = []
    const startRow = Math.max(0, sel.startRow)
    const endRow = Math.min(rows.length - 1, sel.endRow)
    for (let r = startRow; r <= endRow; r++) {
      const row = rows[r]
      if (row) rowIds.push(row.id)
    }
    if (rowIds.length === 0) return null
    return { groupIds: [...groupIdsInRect], rowIds, allRows: false }
  }, [rowSelection, normalizedSelection, rows, displayColumns, tableWorkflowGroupIds])

  const selectionStats = useMemo<SelectionSnapshot['selectionStats']>(() => {
    if (!selectedRunScope) {
      return { hasIncompleteOrFailed: false, hasCompleted: false, hasInFlight: false }
    }
    return classifyExecStatusMix(rows, new Set(selectedRunScope.rowIds), selectedRunScope.groupIds)
  }, [selectedRunScope, rows])

  // Emit selection snapshots so the wrapper can render <TableActionBar>.
  // The grid can't fold this into individual event handlers (running counts
  // come from React Query refetches, not user events) so it's intentionally
  // an effect — but we content-compare against the last sent snapshot so a
  // re-render where nothing actually changed doesn't churn the wrapper.
  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange
  const lastSelectionSnapshotRef = useRef<SelectionSnapshot | null>(null)
  useEffect(() => {
    const prev = lastSelectionSnapshotRef.current
    const sameSingleCell =
      (prev?.singleWorkflowCell ?? null) === null && singleWorkflowCell === null
        ? true
        : prev?.singleWorkflowCell &&
          singleWorkflowCell &&
          prev.singleWorkflowCell.rowId === singleWorkflowCell.rowId &&
          prev.singleWorkflowCell.groupId === singleWorkflowCell.groupId &&
          prev.singleWorkflowCell.executionId === singleWorkflowCell.executionId &&
          prev.singleWorkflowCell.canViewExecution === singleWorkflowCell.canViewExecution
    const sameRunScope =
      (prev?.selectedRunScope ?? null) === null && selectedRunScope === null
        ? true
        : prev?.selectedRunScope &&
          selectedRunScope &&
          prev.selectedRunScope.groupIds.length === selectedRunScope.groupIds.length &&
          prev.selectedRunScope.rowIds.length === selectedRunScope.rowIds.length &&
          prev.selectedRunScope.groupIds.every((id, i) => id === selectedRunScope.groupIds[i]) &&
          prev.selectedRunScope.rowIds.every((id, i) => id === selectedRunScope.rowIds[i])
    const sameStats =
      prev?.selectionStats &&
      prev.selectionStats.hasIncompleteOrFailed === selectionStats.hasIncompleteOrFailed &&
      prev.selectionStats.hasCompleted === selectionStats.hasCompleted &&
      prev.selectionStats.hasInFlight === selectionStats.hasInFlight
    if (
      prev &&
      sameSingleCell &&
      sameRunScope &&
      sameStats &&
      prev.runningInActionBarSelection === runningInActionBarSelection &&
      prev.totalRunning === totalRunning &&
      prev.hasWorkflowColumns === hasWorkflowColumns &&
      prev.actionBarRowIds.length === actionBarRowIds.length &&
      prev.actionBarRowIds.every((id, i) => id === actionBarRowIds[i])
    ) {
      return
    }
    const next: SelectionSnapshot = {
      actionBarRowIds,
      runningInActionBarSelection,
      totalRunning,
      hasWorkflowColumns,
      selectedRunScope,
      selectionStats,
      singleWorkflowCell,
    }
    lastSelectionSnapshotRef.current = next
    onSelectionChangeRef.current(next)
  }, [
    actionBarRowIds,
    runningInActionBarSelection,
    totalRunning,
    hasWorkflowColumns,
    selectedRunScope,
    selectionStats,
    singleWorkflowCell,
  ])

  if (!isLoadingTable && !tableData) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <TableX className='size-[32px] text-[var(--text-muted)]' />
        <div className='flex flex-col items-center gap-1'>
          <h2 className='font-medium text-[20px] text-[var(--text-secondary)]'>Table not found</h2>
          <p className='text-[var(--text-muted)] text-small'>
            This table may have been deleted or moved
          </p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className='flex h-full flex-col overflow-hidden'>
      {embedded && totalRunning > 0 && (
        <div className='flex shrink-0 items-center justify-end border-[var(--border)] border-b px-3 py-1.5'>
          <RunStatusControl
            running={totalRunning}
            onStopAll={onStopAll}
            isStopping={cancelRunsPending}
          />
        </div>
      )}

      <div className='relative flex min-h-0 flex-1'>
        <div
          ref={scrollRef}
          tabIndex={-1}
          className={cn(
            'min-h-0 flex-1 overflow-auto overscroll-none outline-none',
            resizingColumn && 'select-none'
          )}
          data-table-scroll
          onDragOver={handleScrollDragOver}
          onDrop={handleScrollDrop}
        >
          <div
            className='relative h-fit'
            style={{
              width: `calc(${tableWidth}px + ${sidebarReservedPx}px)`,
              paddingRight: sidebarReservedPx,
            }}
          >
            <table
              className='table-fixed border-separate border-spacing-0 text-small'
              style={{ width: `${tableWidth}px` }}
            >
              {isLoadingTable ? (
                <colgroup>
                  <col style={{ width: checkboxColWidth }} />
                  {Array.from({ length: SKELETON_COL_COUNT }).map((_, i) => (
                    <col key={i} style={{ width: COL_WIDTH }} />
                  ))}
                  <col style={{ width: ADD_COL_WIDTH }} />
                </colgroup>
              ) : (
                <TableColGroup
                  columns={displayColumns}
                  columnWidths={columnWidths}
                  checkboxColWidth={checkboxColWidth}
                />
              )}
              <thead className='sticky top-0 z-10'>
                {isLoadingTable ? (
                  <tr>
                    <th className={CELL_HEADER_CHECKBOX}>
                      <div className='flex items-center justify-center'>
                        <Skeleton className='size-[14px] rounded-xs' />
                      </div>
                    </th>
                    {Array.from({ length: SKELETON_COL_COUNT }).map((_, i) => (
                      <th key={i} className={CELL_HEADER}>
                        <div className='flex h-[20px] min-w-0 items-center gap-1.5'>
                          <Skeleton className='size-[14px] shrink-0 rounded-xs' />
                          <Skeleton className='h-[14px]' style={{ width: `${56 + i * 16}px` }} />
                        </div>
                      </th>
                    ))}
                    <th className={CELL_HEADER}>
                      <div className='flex h-[20px] items-center gap-2'>
                        <Skeleton className='size-[14px] shrink-0 rounded-xs' />
                        <Skeleton className='h-[14px] w-[72px]' />
                      </div>
                    </th>
                  </tr>
                ) : (
                  <>
                    {hasWorkflowGroup && (
                      <tr>
                        <th className='sticky left-0 z-[12] border-[var(--border)] border-b bg-[var(--bg)] px-1 py-[5px]' />
                        {headerGroups.map((g) =>
                          g.kind === 'workflow' ? (
                            <WorkflowGroupMetaCell
                              key={`meta-${g.startColIndex}`}
                              workflowId={g.workflowId}
                              size={g.size}
                              startColIndex={g.startColIndex}
                              columnName={displayColumns[g.startColIndex]?.name ?? ''}
                              column={displayColumns[g.startColIndex]}
                              workflows={workflows}
                              isGroupSelected={
                                isColumnSelection &&
                                normalizedSelection !== null &&
                                normalizedSelection.startCol <= g.startColIndex &&
                                normalizedSelection.endCol >= g.startColIndex + g.size - 1
                              }
                              groupId={g.groupId}
                              onSelectGroup={handleGroupSelect}
                              onOpenConfig={() => handleConfigureWorkflowGroup(g.groupId)}
                              onRunColumn={userPermissions.canEdit ? handleRunColumn : undefined}
                              selectedRowIds={selectedRowIds}
                              onInsertLeft={
                                userPermissions.canEdit ? handleInsertColumnLeft : undefined
                              }
                              onInsertRight={
                                userPermissions.canEdit ? handleInsertColumnRight : undefined
                              }
                              onDeleteColumn={
                                userPermissions.canEdit ? handleDeleteColumn : undefined
                              }
                              onDeleteGroup={
                                userPermissions.canEdit ? handleDeleteWorkflowGroup : undefined
                              }
                              onViewWorkflow={handleViewWorkflow}
                              readOnly={!userPermissions.canEdit}
                              onDragStart={
                                userPermissions.canEdit ? handleColumnDragStart : undefined
                              }
                              onDragOver={
                                userPermissions.canEdit ? handleColumnDragOver : undefined
                              }
                              onDragEnd={userPermissions.canEdit ? handleColumnDragEnd : undefined}
                              onDragLeave={
                                userPermissions.canEdit ? handleColumnDragLeave : undefined
                              }
                            />
                          ) : (
                            <th
                              key={`meta-${g.startColIndex}`}
                              className='border-[var(--border)] border-b bg-[var(--bg)] px-2 py-[5px]'
                            />
                          )
                        )}
                        {userPermissions.canEdit && (
                          <th className='border-[var(--border)] border-b bg-[var(--bg)] px-2 py-[5px]' />
                        )}
                      </tr>
                    )}
                    <tr>
                      <SelectAllCheckbox
                        checked={isAllRowsSelected}
                        onCheckedChange={handleSelectAllToggle}
                      />
                      {displayColumns.map((column, idx) => (
                        <ColumnHeaderMenu
                          key={column.key}
                          column={column}
                          colIndex={idx}
                          readOnly={!userPermissions.canEdit}
                          isRenaming={columnRename.editingId === column.name}
                          isColumnSelected={
                            isColumnSelection &&
                            normalizedSelection !== null &&
                            idx >= normalizedSelection.startCol &&
                            idx <= normalizedSelection.endCol
                          }
                          renameValue={
                            columnRename.editingId === column.name ? columnRename.editValue : ''
                          }
                          onRenameValueChange={columnRename.setEditValue}
                          onRenameSubmit={columnRename.submitRename}
                          onRenameCancel={columnRename.cancelRename}
                          onColumnSelect={handleColumnSelect}
                          onChangeType={handleChangeType}
                          onInsertLeft={handleInsertColumnLeft}
                          onInsertRight={handleInsertColumnRight}
                          onDeleteColumn={handleDeleteColumn}
                          onResizeStart={handleColumnResizeStart}
                          onResize={handleColumnResize}
                          onResizeEnd={handleColumnResizeEnd}
                          onAutoResize={handleColumnAutoResize}
                          onDragStart={handleColumnDragStart}
                          onDragOver={handleColumnDragOver}
                          onDragEnd={handleColumnDragEnd}
                          onDragLeave={handleColumnDragLeave}
                          workflows={workflows}
                          workflowGroups={tableWorkflowGroups}
                          sourceInfo={columnSourceInfo.get(column.name)}
                          onOpenConfig={handleConfigureColumn}
                          onViewWorkflow={handleViewWorkflow}
                        />
                      ))}
                      {userPermissions.canEdit && (
                        <NewColumnDropdown
                          trigger='inline-header'
                          disabled={addColumnMutation.isPending}
                          onPickType={handleAddColumnOfType}
                          onPickWorkflow={handleAddWorkflowColumn}
                        />
                      )}
                    </tr>
                  </>
                )}
              </thead>
              <tbody>
                {isLoadingTable || isLoadingRows ? (
                  <TableBodySkeleton colCount={displayColCount} />
                ) : (
                  <>
                    {rows.map((row, index) => (
                      <DataRow
                        key={row.id}
                        row={row}
                        columns={displayColumns}
                        rowIndex={index}
                        isFirstRow={index === 0}
                        editingColumnName={
                          editingCell?.rowId === row.id ? editingCell.columnName : null
                        }
                        initialCharacter={editingCell?.rowId === row.id ? initialCharacter : null}
                        pendingCellValue={
                          pendingUpdate && pendingUpdate.rowId === row.id
                            ? pendingUpdate.data
                            : null
                        }
                        normalizedSelection={normalizedSelection}
                        onClick={handleCellClick}
                        onDoubleClick={handleCellDoubleClick}
                        onSave={handleInlineSave}
                        onCancel={handleInlineCancel}
                        onContextMenu={handleRowContextMenu}
                        onCellMouseDown={handleCellMouseDown}
                        onCellMouseEnter={handleCellMouseEnter}
                        isRowChecked={rowSelectionIncludes(rowSelection, row.id)}
                        onRowToggle={handleRowToggle}
                        runningCount={runningByRowId.get(row.id) ?? 0}
                        hasWorkflowColumns={hasWorkflowColumns}
                        numDivWidth={numDivWidth}
                        onStopRow={onStopRow}
                        onRunRow={onRunRow}
                        workflowGroups={tableWorkflowGroups}
                      />
                    ))}
                  </>
                )}
              </tbody>
            </table>
            {resizingColumn && (
              <div
                className='-translate-x-[1.5px] pointer-events-none absolute top-0 z-20 h-full w-[2px] bg-[var(--selection)]'
                style={{ left: resizeIndicatorLeft }}
              />
            )}
            {dropColumnBounds !== null && (
              <>
                <div
                  className={cn(
                    'pointer-events-none absolute top-0 z-[15] h-full',
                    SELECTION_TINT_BG
                  )}
                  style={{ left: dropColumnBounds.left, width: dropColumnBounds.width }}
                />
                <div
                  className='-translate-x-[1px] pointer-events-none absolute top-0 z-20 h-full w-[2px] bg-[var(--selection)]'
                  style={{ left: dropColumnBounds.lineLeft }}
                />
              </>
            )}
          </div>
          {!isLoadingTable && !isLoadingRows && userPermissions.canEdit && (
            <AddRowButton onClick={handleAppendRow} />
          )}
        </div>
      </div>

      <ContextMenu
        contextMenu={contextMenu}
        onClose={closeContextMenu}
        onEditCell={handleContextMenuEditCell}
        onDelete={handleContextMenuDelete}
        onInsertAbove={handleInsertRowAbove}
        onInsertBelow={handleInsertRowBelow}
        onDuplicate={handleDuplicateRow}
        onViewExecution={handleViewExecution}
        canViewExecution={Boolean(contextMenuExecutionId) && contextMenuHasStartedRun}
        canEditCell={!contextMenuIsWorkflowColumn}
        selectedRowCount={selectedRowCount}
        onRunWorkflows={
          userPermissions.canEdit && hasWorkflowColumns && contextMenuStats.hasIncompleteOrFailed
            ? handleRunWorkflowsOnSelection
            : undefined
        }
        onRefreshWorkflows={
          userPermissions.canEdit && hasWorkflowColumns && contextMenuStats.hasCompleted
            ? handleRefreshWorkflowsOnSelection
            : undefined
        }
        onStopWorkflows={
          userPermissions.canEdit && hasWorkflowColumns ? handleStopWorkflowsOnSelection : undefined
        }
        runningInSelectionCount={runningInContextSelection}
        hasWorkflowColumns={hasWorkflowColumns}
        disableEdit={!userPermissions.canEdit}
        disableInsert={!userPermissions.canEdit}
        disableDelete={!userPermissions.canEdit}
      />

      <ExpandedCellPopover
        expandedCell={expandedCell}
        onClose={() => setExpandedCell(null)}
        rows={rows}
        columns={displayColumns}
        onSave={handleInlineSave}
        canEdit={userPermissions.canEdit}
        scrollContainer={scrollRef.current}
      />
    </div>
  )
}
