'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Square } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import {
  Button,
  Checkbox,
  Download,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
  toast,
  Upload,
} from '@/components/emcn'
import {
  Pencil,
  PlayOutline,
  Plus,
  Table as TableIcon,
  TableX,
  Trash,
} from '@/components/emcn/icons'
import { Loader } from '@/components/emcn/icons/loader'
import { cn } from '@/lib/core/utils/cn'
import { captureEvent } from '@/lib/posthog/client'
import type { ColumnDefinition, Filter, SortDirection, TableRow as TableRowType } from '@/lib/table'
import type { ColumnOption, SortConfig } from '@/app/workspace/[workspaceId]/components'
import { ResourceHeader, ResourceOptionsBar } from '@/app/workspace/[workspaceId]/components'
import { LogDetails } from '@/app/workspace/[workspaceId]/logs/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ImportCsvDialog } from '@/app/workspace/[workspaceId]/tables/components/import-csv-dialog'
import { useLogByExecutionId } from '@/hooks/queries/logs'
import {
  downloadTableExport,
  useAddTableColumn,
  useBatchCreateTableRows,
  useBatchUpdateTableRows,
  useCancelTableRuns,
  useCreateTableRow,
  useDeleteColumn,
  useDeleteTable,
  useDeleteWorkflowGroup,
  useRenameTable,
  useRunGroup,
  useUpdateColumn,
  useUpdateTableMetadata,
  useUpdateTableRow,
  useUpdateWorkflowGroup,
} from '@/hooks/queries/tables'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { extractCreatedRowId, useTableUndo } from '@/hooks/use-table-undo'
import { useLogDetailsUIStore } from '@/stores/logs/store'
import type { DeletedRowSnapshot } from '@/stores/table/types'
import { useContextMenu, useRowExecution, useTable } from '../../hooks'
import type { EditingCell, QueryOptions, SaveReason } from '../../types'
import { cleanCellValue, storageToDisplay } from '../../utils'
import { type ColumnConfigState, ColumnSidebar } from '../column-sidebar/column-sidebar'
import { ContextMenu } from '../context-menu'
import { RowModal } from '../row-modal'
import { TableFilter } from '../table-filter'
import { CellContent } from './cells/cell-content'
import { ExpandedCellPopover } from './cells/expanded-cell-popover'
import { COL_WIDTH, SELECTION_TINT_BG } from './constants'
import { ColumnHeaderMenu } from './headers/column-header-menu'
import { COLUMN_TYPE_ICONS } from './headers/column-type-icon'
import { WorkflowGroupMetaCell } from './headers/workflow-group-meta-cell'
import type { DisplayColumn } from './types'
import {
  areRowDepsSatisfied,
  buildHeaderGroups,
  type CellCoord,
  collectRowSnapshots,
  computeNormalizedSelection,
  expandToDisplayColumns,
  moveCell,
  type NormalizedSelection,
  readExecution,
} from './utils'

const logger = createLogger('TableView')

const EMPTY_CHECKED_ROWS = new Set<number>()
const COL_WIDTH_MIN = 80
const COL_WIDTH_AUTO_FIT_MAX = 1000
// Wide enough to host the row-number + per-row run button side by side.
// Single-digit row numbers (rows 1–9) and multi-digit (10+) need to render
// with the play button at the same x-position so the column doesn't reflow
// row-by-row.
const CHECKBOX_COL_WIDTH = 56
const ADD_COL_WIDTH = 120
/** Width of the column-config slideout (matches `column-sidebar.tsx`'s `w-[400px]`). */
const COLUMN_SIDEBAR_WIDTH = 400
const SKELETON_COL_COUNT = 4
const SKELETON_ROW_COUNT = 10
const ROW_HEIGHT_ESTIMATE = 35

const CELL = 'border-[var(--border)] border-r border-b px-2 py-[7px] align-middle select-none'
const CELL_CHECKBOX =
  'border-[var(--border)] border-r border-b px-1 py-[7px] align-middle select-none'
const CELL_HEADER =
  'border-[var(--border)] border-r border-b bg-[var(--bg)] px-2 py-[7px] text-left align-middle'
const CELL_HEADER_CHECKBOX =
  'border-[var(--border)] border-r border-b bg-[var(--bg)] px-1 py-[7px] text-center align-middle'
const CELL_CONTENT =
  'relative min-h-[20px] min-w-0 overflow-clip text-ellipsis whitespace-nowrap text-small'
const SELECTION_OVERLAY =
  'pointer-events-none absolute -top-px -right-px -bottom-px -left-px z-[5] border-[2px] border-[var(--selection)]'

interface TableProps {
  workspaceId?: string
  tableId?: string
  embedded?: boolean
}

export function Table({
  workspaceId: propWorkspaceId,
  tableId: propTableId,
  embedded,
}: TableProps = {}) {
  const params = useParams()
  const router = useRouter()
  const workspaceId = propWorkspaceId || (params.workspaceId as string)
  const tableId = propTableId || (params.tableId as string)
  const posthog = usePostHog()

  useEffect(() => {
    if (!tableId || !workspaceId) return
    captureEvent(posthog, 'table_opened', { table_id: tableId, workspace_id: workspaceId })
  }, [tableId, workspaceId, posthog])

  const [queryOptions, setQueryOptions] = useState<QueryOptions>({
    filter: null,
    sort: null,
  })
  const [editingRow, setEditingRow] = useState<TableRowType | null>(null)
  const [deletingRows, setDeletingRows] = useState<DeletedRowSnapshot[]>([])
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [initialCharacter, setInitialCharacter] = useState<string | null>(null)
  const [expandedCell, setExpandedCell] = useState<EditingCell | null>(null)
  const [selectionAnchor, setSelectionAnchor] = useState<CellCoord | null>(null)
  const [selectionFocus, setSelectionFocus] = useState<CellCoord | null>(null)
  const [checkedRows, setCheckedRows] = useState(EMPTY_CHECKED_ROWS)
  const [isColumnSelection, setIsColumnSelection] = useState(false)
  const lastCheckboxRowRef = useRef<number | null>(null)
  const isColumnSelectionRef = useRef(false)
  const [showDeleteTableConfirm, setShowDeleteTableConfirm] = useState(false)
  const [deletingColumns, setDeletingColumns] = useState<string[] | null>(null)
  const [isImportCsvOpen, setIsImportCsvOpen] = useState(false)

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
    workflowNameById,
  } = useTable({ workspaceId, tableId, queryOptions })

  const fetchNextPageRef = useRef(fetchNextPage)
  fetchNextPageRef.current = fetchNextPage
  const hasNextPageRef = useRef(hasNextPage)
  hasNextPageRef.current = hasNextPage
  const isFetchingNextPageRef = useRef(isFetchingNextPage)
  isFetchingNextPageRef.current = isFetchingNextPage
  const isAppendingRowRef = useRef(false)

  const userPermissions = useUserPermissionsContext()
  const canEditRef = useRef(userPermissions.canEdit)
  canEditRef.current = userPermissions.canEdit

  const {
    contextMenu,
    handleRowContextMenu: baseHandleRowContextMenu,
    closeContextMenu,
  } = useContextMenu()

  const { runWorkflowGroup } = useRowExecution()
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
  const cancelRunsMutation = useCancelTableRuns({ workspaceId, tableId })
  const runGroupMutation = useRunGroup({ workspaceId, tableId })
  const deleteWorkflowGroupMutation = useDeleteWorkflowGroup({ workspaceId, tableId })
  const updateWorkflowGroupMutation = useUpdateWorkflowGroup({ workspaceId, tableId })

  const handleRunGroup = useCallback(
    (groupId: string, workflowId: string, runMode: 'all' | 'incomplete' = 'all') => {
      runGroupMutation.mutate({ groupId, workflowId, runMode })
    },
    // mutate is stable; intentionally excluded from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  function handleColumnOrderChange(order: string[]) {
    setColumnOrder(order)
  }

  // Width keys are either the logical name or `${name}::${path}` (fanned-out
  // workflow columns). Rename rewrites every key whose prefix matches.
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

  // `columns`, `tableWorkflowGroups`, `workflowStates`, `columnSourceInfo`,
  // and `workflowNameById` come from `useTable` above.

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

  const headerGroups = useMemo(
    () => buildHeaderGroups(displayColumns, tableWorkflowGroups),
    [displayColumns, tableWorkflowGroups]
  )
  const hasWorkflowGroup = headerGroups.some((g) => g.kind === 'workflow')

  const maxPosition = useMemo(() => (rows.length > 0 ? rows[rows.length - 1].position : -1), [rows])
  const maxPositionRef = useRef(maxPosition)
  maxPositionRef.current = maxPosition

  const positionMap = useMemo(() => {
    const map = new Map<number, TableRowType>()
    for (const row of rows) {
      map.set(row.position, row)
    }
    return map
  }, [rows])
  const positionMapRef = useRef(positionMap)
  positionMapRef.current = positionMap

  const normalizedSelection = useMemo(
    () => computeNormalizedSelection(selectionAnchor, selectionFocus),
    [selectionAnchor, selectionFocus]
  )

  const displayColCount = isLoadingTable ? SKELETON_COL_COUNT : displayColumns.length
  const tableWidth = useMemo(() => {
    const colsWidth = isLoadingTable
      ? displayColCount * COL_WIDTH
      : displayColumns.reduce((sum, col) => sum + (columnWidths[col.key] ?? COL_WIDTH), 0)
    return CHECKBOX_COL_WIDTH + colsWidth + ADD_COL_WIDTH
  }, [isLoadingTable, displayColCount, displayColumns, columnWidths])

  const resizeIndicatorLeft = useMemo(() => {
    if (!resizingColumn) return 0
    let left = CHECKBOX_COL_WIDTH
    for (const col of displayColumns) {
      left += columnWidths[col.key] ?? COL_WIDTH
      if (col.key === resizingColumn) return left
    }
    return 0
  }, [resizingColumn, displayColumns, columnWidths])

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

    let left = CHECKBOX_COL_WIDTH
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
  }, [dropTargetColumnName, dragColumnName, dropSide, displayColumns, columnWidths])

  const isAllRowsSelected = useMemo(() => {
    if (checkedRows.size > 0 && rows.length > 0 && checkedRows.size >= rows.length) {
      for (const row of rows) {
        if (!checkedRows.has(row.position)) return false
      }
      return true
    }
    return (
      normalizedSelection !== null &&
      maxPosition >= 0 &&
      normalizedSelection.startRow === 0 &&
      normalizedSelection.endRow === maxPosition &&
      normalizedSelection.startCol === 0 &&
      normalizedSelection.endCol === displayColumns.length - 1
    )
  }, [checkedRows, normalizedSelection, maxPosition, displayColumns.length, rows])

  const isAllRowsSelectedRef = useRef(isAllRowsSelected)
  isAllRowsSelectedRef.current = isAllRowsSelected

  const columnsRef = useRef(displayColumns)
  const schemaColumnsRef = useRef(columns)
  const workflowGroupsRef = useRef(tableWorkflowGroups)
  const rowsRef = useRef(rows)
  const selectionAnchorRef = useRef(selectionAnchor)
  const selectionFocusRef = useRef(selectionFocus)

  const checkedRowsRef = useRef(checkedRows)
  checkedRowsRef.current = checkedRows

  columnsRef.current = displayColumns
  schemaColumnsRef.current = columns
  workflowGroupsRef.current = tableWorkflowGroups
  rowsRef.current = rows
  selectionAnchorRef.current = selectionAnchor
  selectionFocusRef.current = selectionFocus
  isColumnSelectionRef.current = isColumnSelection

  const deleteTableMutation = useDeleteTable(workspaceId)
  const renameTableMutation = useRenameTable(workspaceId)

  const tableHeaderRename = useInlineRename({
    onSave: (_id, name) => {
      if (tableData) {
        pushUndoRef.current({
          type: 'rename-table',
          tableId,
          previousName: tableData.name,
          newName: name,
        })
      }
      renameTableMutation.mutate({ tableId, name })
    },
  })

  const columnRename = useInlineRename({
    onSave: (columnName, newName) => {
      pushUndoRef.current({ type: 'rename-column', oldName: columnName, newName })
      handleColumnRename(columnName, newName)
      updateColumnMutation.mutate({ columnName, updates: { name: newName } })
    },
  })

  const handleNavigateBack = useCallback(() => {
    router.push(`/workspace/${workspaceId}/tables`)
  }, [router, workspaceId])

  const handleDeleteTable = useCallback(async () => {
    try {
      await deleteTableMutation.mutateAsync(tableId)
      setShowDeleteTableConfirm(false)
      router.push(`/workspace/${workspaceId}/tables`)
    } catch {
      setShowDeleteTableConfirm(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, router, workspaceId])

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

  const handleContextMenuEditCell = useCallback(() => {
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
  }, [contextMenu.row, contextMenu.columnName, closeContextMenu])

  const handleContextMenuDelete = useCallback(() => {
    if (!contextMenu.row) {
      closeContextMenu()
      return
    }

    const checked = checkedRowsRef.current
    const pMap = positionMapRef.current
    let snapshots: DeletedRowSnapshot[] = []

    if (checked.size > 0 && checked.has(contextMenu.row.position)) {
      snapshots = collectRowSnapshots(checked, pMap)
    } else {
      const sel = computeNormalizedSelection(selectionAnchorRef.current, selectionFocusRef.current)
      const isInSelection =
        sel !== null &&
        contextMenu.row.position >= sel.startRow &&
        contextMenu.row.position <= sel.endRow

      if (isInSelection && sel) {
        const positions = Array.from(
          { length: sel.endRow - sel.startRow + 1 },
          (_, i) => sel.startRow + i
        )
        snapshots = collectRowSnapshots(positions, pMap)
      } else {
        snapshots = [
          {
            rowId: contextMenu.row.id,
            data: { ...contextMenu.row.data },
            position: contextMenu.row.position,
          },
        ]
      }
    }

    if (snapshots.length > 0) {
      setDeletingRows(snapshots)
    }

    closeContextMenu()
  }, [contextMenu.row, closeContextMenu])

  const handleInsertRow = useCallback(
    (offset: 0 | 1) => {
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
    },
    [contextMenu.row, closeContextMenu]
  )

  const handleInsertRowAbove = useCallback(() => handleInsertRow(0), [handleInsertRow])
  const handleInsertRowBelow = useCallback(() => handleInsertRow(1), [handleInsertRow])

  const contextMenuColumnInfo = useMemo<{
    isWorkflowColumn: boolean
    executionId: string | null
  }>(() => {
    if (!contextMenu.row || !contextMenu.columnName) {
      return { isWorkflowColumn: false, executionId: null }
    }
    const column = columnsRef.current.find((c) => c.name === contextMenu.columnName)
    const groupId = column?.workflowGroupId
    if (!column || !groupId) {
      return { isWorkflowColumn: false, executionId: null }
    }
    const exec = contextMenu.row.executions?.[groupId]
    return { isWorkflowColumn: true, executionId: exec?.executionId ?? null }
  }, [contextMenu.row, contextMenu.columnName])
  const contextMenuExecutionId = contextMenuColumnInfo.executionId
  const contextMenuIsWorkflowColumn = contextMenuColumnInfo.isWorkflowColumn

  const handleViewExecution = useCallback(() => {
    if (!contextMenuExecutionId) return
    setConfigState(null)
    setExecutionDetailsId(contextMenuExecutionId)
    closeContextMenu()
  }, [contextMenuExecutionId, closeContextMenu])

  const handleDuplicateRow = useCallback(() => {
    if (!contextMenu.row) return
    const rowData = { ...contextMenu.row.data }
    const position = contextMenu.row.position + 1
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
          setSelectionAnchor({ rowIndex: position, colIndex })
          setSelectionFocus(null)
        },
      }
    )
  }, [contextMenu.row, closeContextMenu])

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
            pushUndoRef.current({
              type: 'create-row',
              rowId: newRowId,
              position: maxPositionRef.current + 1,
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
      setCheckedRows((prev) => (prev.size === 0 ? prev : EMPTY_CHECKED_ROWS))
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

    if (shiftKey && lastCheckboxRowRef.current !== null) {
      const from = Math.min(lastCheckboxRowRef.current, rowIndex)
      const to = Math.max(lastCheckboxRowRef.current, rowIndex)
      const pMap = positionMapRef.current
      setCheckedRows((prev) => {
        const next = new Set(prev)
        for (const [pos] of pMap) {
          if (pos >= from && pos <= to) next.add(pos)
        }
        return next
      })
    } else {
      setCheckedRows((prev) => {
        const next = new Set(prev)
        if (next.has(rowIndex)) {
          next.delete(rowIndex)
        } else {
          next.add(rowIndex)
        }
        return next
      })
    }
    lastCheckboxRowRef.current = rowIndex
    scrollRef.current?.focus({ preventScroll: true })
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectionAnchor(null)
    setSelectionFocus(null)
    setCheckedRows((prev) => (prev.size === 0 ? prev : EMPTY_CHECKED_ROWS))
    setIsColumnSelection(false)
    lastCheckboxRowRef.current = null
  }, [])

  const handleColumnSelect = useCallback((colIndex: number, shiftKey: boolean) => {
    const lastRow = maxPositionRef.current
    if (lastRow < 0) return

    setEditingCell(null)
    setCheckedRows((prev) => (prev.size === 0 ? prev : EMPTY_CHECKED_ROWS))
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
    const lastRow = maxPositionRef.current
    if (lastRow < 0) return

    setEditingCell(null)
    setCheckedRows((prev) => (prev.size === 0 ? prev : EMPTY_CHECKED_ROWS))
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
    setCheckedRows((prev) => (prev.size === 0 ? prev : EMPTY_CHECKED_ROWS))
    suppressFocusScrollRef.current = true
    setSelectionAnchor({ rowIndex: 0, colIndex: 0 })
    setSelectionFocus({
      rowIndex: maxPositionRef.current,
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
    setCheckedRows((prev) => (prev.size === 0 ? prev : EMPTY_CHECKED_ROWS))
    setIsColumnSelection(false)
  }, [])

  const handleColumnDragOver = useCallback((columnName: string, side: 'left' | 'right') => {
    // Suppress drop targeting while hovering siblings of the dragged column's
    // own group: reordering inside a group is meaningless (the group renders
    // as a unit) and the chasing indicator just flickers.
    const dragged = dragColumnNameRef.current
    if (dragged) {
      const cols = schemaColumnsRef.current
      const draggedGid = cols.find((c) => c.name === dragged)?.workflowGroupId
      const targetGid = cols.find((c) => c.name === columnName)?.workflowGroupId
      if (draggedGid && draggedGid === targetGid) {
        if (dropTargetColumnNameRef.current !== null) setDropTargetColumnName(null)
        return
      }
    }
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
      const currentOrder = columnOrderRef.current ?? schemaCols.map((c) => c.name)

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
    let left = CHECKBOX_COL_WIDTH
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
    if (!tableData?.metadata || metadataSeededRef.current) return
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
    setSelectionFocus((prev) => {
      if (!prev || prev.rowIndex !== maxPosition) {
        return { rowIndex: maxPosition, colIndex: prev?.colIndex ?? selectionAnchor.colIndex }
      }
      return prev
    })
  }, [isColumnSelection, maxPosition, selectionAnchor])

  useEffect(() => {
    const handleMouseUp = () => {
      isDraggingRef.current = false
    }
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [])

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

  const handleCellClick = useCallback((rowId: string, columnName: string) => {
    const column = columnsRef.current.find((c) => c.name === columnName)
    if (column?.type === 'boolean') {
      if (!canEditRef.current) return
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
  }, [])

  // Double-click highlights the cell's text and, only if the text is actually
  // truncated, opens the expanded popover. The cell has `select-none` which
  // suppresses the highlight even for programmatic selections, so we override
  // `user-select` on the inner element until the next click. Workflow cells nest
  // their text inside a span with its own `overflow-clip`, so we measure the leaf
  // element's scroll dimensions, not just the wrapper div's.
  const handleCellDoubleClick = useCallback(
    (rowId: string, columnName: string, columnKey: string) => {
      setSelectionFocus(null)
      setIsColumnSelection(false)

      const row = rowsRef.current.find((r) => r.id === rowId)
      const colIndex = columnsRef.current.findIndex((c) => c.key === columnKey)
      let overflows = true
      if (row && colIndex !== -1) {
        const td = document.querySelector<HTMLElement>(
          `[data-table-scroll] [data-row="${row.position}"][data-col="${colIndex}"]`
        )
        const inner = td?.querySelector<HTMLElement>(':scope > div:last-child')
        if (inner) {
          const candidates: HTMLElement[] = [inner]
          const descendants = inner.querySelectorAll<HTMLElement>('*')
          for (const el of descendants) candidates.push(el)
          overflows = candidates.some(
            (el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
          )

          inner.style.userSelect = 'text'
          const clear = () => {
            inner.style.userSelect = ''
            window.removeEventListener('mousedown', clear, true)
          }
          window.addEventListener('mousedown', clear, true)

          const selection = window.getSelection()
          if (selection) {
            const range = document.createRange()
            range.selectNodeContents(inner)
            selection.removeAllRanges()
            selection.addRange(range)
          }
        }
      }

      if (overflows) setExpandedCell({ rowId, columnName, columnKey })
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

  const updateMetadataRef = useRef(updateMetadataMutation.mutate)
  updateMetadataRef.current = updateMetadataMutation.mutate

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
        setCheckedRows((prev) => (prev.size === 0 ? prev : EMPTY_CHECKED_ROWS))
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
          setCheckedRows((prev) => (prev.size === 0 ? prev : EMPTY_CHECKED_ROWS))
          setSelectionAnchor({ rowIndex: 0, colIndex: 0 })
          setSelectionFocus({
            rowIndex: maxPositionRef.current,
            colIndex: currentCols.length - 1,
          })
          setIsColumnSelection(false)
        }
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === ' ') {
        const a = selectionAnchorRef.current
        if (!a || editingCellRef.current) return
        const lastRow = maxPositionRef.current
        if (lastRow < 0) return
        e.preventDefault()
        setCheckedRows((prev) => (prev.size === 0 ? prev : EMPTY_CHECKED_ROWS))
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
        setCheckedRows((prev) => (prev.size === 0 ? prev : EMPTY_CHECKED_ROWS))
        lastCheckboxRowRef.current = null
        setIsColumnSelection(false)
        setSelectionAnchor({ rowIndex: a.rowIndex, colIndex: 0 })
        setSelectionFocus({ rowIndex: a.rowIndex, colIndex: currentCols.length - 1 })
        return
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && checkedRowsRef.current.size > 0) {
        if (editingCellRef.current) return
        if (!canEditRef.current) return
        e.preventDefault()
        const checked = checkedRowsRef.current
        const pMap = positionMapRef.current
        const currentCols = columnsRef.current
        const undoCells: Array<{ rowId: string; data: Record<string, unknown> }> = []
        const batchUpdates: Array<{ rowId: string; data: Record<string, unknown> }> = []
        for (const pos of checked) {
          const row = pMap.get(pos)
          if (!row) continue
          const updates: Record<string, unknown> = {}
          const previousData: Record<string, unknown> = {}
          for (const col of currentCols) {
            previousData[col.name] = row.data[col.name] ?? null
            updates[col.name] = null
          }
          undoCells.push({ rowId: row.id, data: previousData })
          batchUpdates.push({ rowId: row.id, data: updates })
        }
        if (batchUpdates.length > 0) {
          batchUpdateRef.current({ updates: batchUpdates })
        }
        if (undoCells.length > 0) {
          pushUndoRef.current({ type: 'clear-cells', cells: undoCells })
        }
        return
      }

      const anchor = selectionAnchorRef.current
      if (!anchor || editingCellRef.current) return

      const cols = columnsRef.current
      const mp = maxPositionRef.current
      const totalRows = mp + 1

      if (e.shiftKey && e.key === 'Enter') {
        if (!canEditRef.current) return
        const row = positionMapRef.current.get(anchor.rowIndex)
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
              setSelectionAnchor({ rowIndex: position, colIndex })
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

        const row = positionMapRef.current.get(anchor.rowIndex)
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
        const row = positionMapRef.current.get(anchor.rowIndex)
        if (row) {
          setEditingRow(row)
        }
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        setCheckedRows((prev) => (prev.size === 0 ? prev : EMPTY_CHECKED_ROWS))
        setIsColumnSelection(false)
        lastCheckboxRowRef.current = null
        setSelectionAnchor(moveCell(anchor, cols.length, totalRows, e.shiftKey ? -1 : 1))
        setSelectionFocus(null)
        return
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        setCheckedRows((prev) => (prev.size === 0 ? prev : EMPTY_CHECKED_ROWS))
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
        const pMap = positionMapRef.current
        const sourceRow = pMap.get(sel.startRow)
        if (!sourceRow) return
        const undoCells: Array<{
          rowId: string
          oldData: Record<string, unknown>
          newData: Record<string, unknown>
        }> = []
        for (let r = sel.startRow + 1; r <= sel.endRow; r++) {
          const row = pMap.get(r)
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
        const pMap = positionMapRef.current
        const undoCells: Array<{ rowId: string; data: Record<string, unknown> }> = []
        const batchUpdates: Array<{ rowId: string; data: Record<string, unknown> }> = []
        for (let r = sel.startRow; r <= sel.endRow; r++) {
          const row = pMap.get(r)
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
        if (batchUpdates.length > 0) {
          batchUpdateRef.current({ updates: batchUpdates })
        }
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

        const row = positionMapRef.current.get(anchor.rowIndex)
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

      const checked = checkedRowsRef.current
      const cols = columnsRef.current
      const pMap = positionMapRef.current

      if (checked.size > 0) {
        e.preventDefault()
        const sorted = Array.from(checked).sort((a, b) => a - b)
        const lines: string[] = []
        for (const pos of sorted) {
          const row = pMap.get(pos)
          if (!row) continue
          const cells: string[] = cols.map((col) => {
            const value: unknown = row.data[col.name]
            if (value === null || value === undefined) return ''
            return typeof value === 'object' ? JSON.stringify(value) : String(value)
          })
          lines.push(cells.join('\t'))
        }
        e.clipboardData?.setData('text/plain', lines.join('\n'))
        return
      }

      const anchor = selectionAnchorRef.current
      if (!anchor) return

      const sel = computeNormalizedSelection(anchor, selectionFocusRef.current)
      if (!sel) return

      e.preventDefault()
      const lines: string[] = []
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        const cells: string[] = []
        for (let c = sel.startCol; c <= sel.endCol; c++) {
          if (c >= cols.length) break
          const row = pMap.get(r)
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

      const checked = checkedRowsRef.current
      const cols = columnsRef.current
      const pMap = positionMapRef.current
      const undoCells: Array<{ rowId: string; data: Record<string, unknown> }> = []
      const batchUpdates: Array<{ rowId: string; data: Record<string, unknown> }> = []

      if (checked.size > 0) {
        e.preventDefault()
        const sorted = Array.from(checked).sort((a, b) => a - b)
        const lines: string[] = []
        for (const pos of sorted) {
          const row = pMap.get(pos)
          if (!row) continue
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
          undoCells.push({ rowId: row.id, data: previousData })
          batchUpdates.push({ rowId: row.id, data: updates })
        }
        e.clipboardData?.setData('text/plain', lines.join('\n'))
      } else {
        const anchor = selectionAnchorRef.current
        if (!anchor) return

        const sel = computeNormalizedSelection(anchor, selectionFocusRef.current)
        if (!sel) return

        e.preventDefault()
        const lines: string[] = []
        for (let r = sel.startRow; r <= sel.endRow; r++) {
          const row = pMap.get(r)
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
      }

      if (batchUpdates.length > 0) {
        batchUpdateRef.current({ updates: batchUpdates })
      }
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
      const pMap = positionMapRef.current

      const undoCells: Array<{ rowId: string; data: Record<string, unknown> }> = []
      const updateBatch: Array<{ rowId: string; data: Record<string, unknown> }> = []
      const createBatchRows: Array<Record<string, unknown>> = []
      const createBatchPositions: number[] = []

      for (let r = 0; r < pasteRows.length; r++) {
        const targetRow = currentAnchor.rowIndex + r

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

        const existingRow = pMap.get(targetRow)
        if (existingRow) {
          const previousData: Record<string, unknown> = {}
          for (const key of Object.keys(rowData)) {
            previousData[key] = existingRow.data[key] ?? null
          }
          undoCells.push({ rowId: existingRow.id, data: previousData })
          updateBatch.push({ rowId: existingRow.id, data: rowData })
        } else {
          createBatchRows.push(rowData)
          createBatchPositions.push(targetRow)
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
    const totalRows = maxPositionRef.current + 1

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

  const generateColumnName = useCallback(() => {
    const existing = schemaColumnsRef.current.map((c) => c.name.toLowerCase())
    let name = 'untitled'
    let i = 2
    while (existing.includes(name.toLowerCase())) {
      name = `untitled_${i}`
      i++
    }
    return name
  }, [])

  const handleAddColumn = useCallback(() => {
    // Open the sidebar in `'create'` mode — nothing is persisted until the
    // user fills in name/type and hits Save. The sidebar's save flow handles
    // both scalar (`addColumn`) and workflow-group (`addWorkflowGroup`) paths.
    const name = generateColumnName()
    setExecutionDetailsId(null)
    setConfigState({ mode: 'create', columnName: name, proposedName: name })
  }, [generateColumnName])

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
   * Config state for the side panel:
   * - `null` → closed.
   * - `{ mode: 'edit' }` → configuring an existing column (any type).
   * - `{ mode: 'new' }` → user changed an existing column to workflow; not persisted until Save.
   * - `{ mode: 'create' }` → user picked a workflow from "Add column"; column doesn't exist yet,
   *   created on Save in a single POST.
   */
  const [configState, setConfigState] = useState<ColumnConfigState>(null)
  /** Execution id whose run details are open in the slideout. */
  const [executionDetailsId, setExecutionDetailsId] = useState<string | null>(null)
  /**
   * Right padding added to the table's scroll content while a slideout panel
   * is open, equal to the panel's width. Without it, the rightmost columns are
   * clipped under the panel and there's no way to scroll them into view.
   * The two panels are mutually exclusive (each opener closes the other).
   */
  const logPanelWidth = useLogDetailsUIStore((state) => state.panelWidth)
  const sidebarReservedPx = configState
    ? COLUMN_SIDEBAR_WIDTH
    : executionDetailsId
      ? logPanelWidth
      : 0

  const handleConfigureColumn = useCallback((columnName: string) => {
    setExecutionDetailsId(null)
    setConfigState({ mode: 'edit', columnName })
  }, [])

  const handleDeleteWorkflowGroup = useCallback(
    (groupId: string) => {
      deleteWorkflowGroupMutation.mutate({ groupId })
    },
    [deleteWorkflowGroupMutation]
  )

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
  const hideWorkflowOutputColumns = useCallback(
    (names: string[]) => {
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
        updateWorkflowGroupMutation.mutate({
          groupId: group.id,
          workflowId: group.workflowId,
          name: group.name,
          dependencies: group.dependencies,
          outputs: remaining,
        })
      }
      return true
    },
    [updateWorkflowGroupMutation]
  )

  const handleDeleteColumn = useCallback(
    (columnName: string) => {
      const names = resolveDeletionNames(columnName)
      // If every target is a workflow output AND removing them all leaves each
      // group with ≥1 output, hide them directly — no destructive-confirm
      // modal, since the workflow can re-produce the value any time.
      if (hideWorkflowOutputColumns(names)) return
      setDeletingColumns(names)
    },
    [resolveDeletionNames, hideWorkflowOutputColumns]
  )

  const handleDeleteColumnConfirm = useCallback(() => {
    if (!deletingColumns || deletingColumns.length === 0) return
    const columnsToDelete = [...deletingColumns]
    setDeletingColumns(null)

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
  }, [deletingColumns])

  const handleSortChange = useCallback((column: string, direction: SortDirection) => {
    setQueryOptions((prev) => ({ ...prev, sort: { [column]: direction } }))
  }, [])

  const handleSortClear = useCallback(() => {
    setQueryOptions((prev) => ({ ...prev, sort: null }))
  }, [])

  const handleFilterApply = useCallback((filter: Filter | null) => {
    setQueryOptions((prev) => ({ ...prev, filter }))
  }, [])

  const [filterOpen, setFilterOpen] = useState(false)

  const handleFilterToggle = useCallback(() => {
    setFilterOpen((prev) => !prev)
  }, [])

  const handleFilterClose = useCallback(() => {
    setFilterOpen(false)
  }, [])

  const columnOptions = useMemo<ColumnOption[]>(
    () =>
      displayColumns.map((col) => ({
        id: col.name,
        label: col.name,
        type: col.type,
        icon: COLUMN_TYPE_ICONS[col.type],
      })),
    [displayColumns]
  )

  const tableDataRef = useRef(tableData)
  tableDataRef.current = tableData

  const handleStartTableRename = useCallback(() => {
    const data = tableDataRef.current
    if (data) tableHeaderRename.startRename(tableId, data.name)
  }, [tableHeaderRename.startRename, tableId])

  const handleShowDeleteTableConfirm = useCallback(() => {
    setShowDeleteTableConfirm(true)
  }, [])

  const hasTableData = !!tableData

  const breadcrumbs = useMemo(
    () => [
      { label: 'Tables', onClick: handleNavigateBack },
      {
        label: tableData?.name ?? '',
        editing: tableHeaderRename.editingId
          ? {
              isEditing: true,
              value: tableHeaderRename.editValue,
              onChange: tableHeaderRename.setEditValue,
              onSubmit: tableHeaderRename.submitRename,
              onCancel: tableHeaderRename.cancelRename,
            }
          : undefined,
        dropdownItems: [
          {
            label: 'Rename',
            icon: Pencil,
            disabled: !hasTableData,
            onClick: handleStartTableRename,
          },
          {
            label: 'Delete',
            icon: Trash,
            disabled: !hasTableData,
            onClick: handleShowDeleteTableConfirm,
          },
        ],
      },
    ],
    [
      handleNavigateBack,
      tableData?.name,
      tableHeaderRename.editingId,
      tableHeaderRename.editValue,
      tableHeaderRename.setEditValue,
      tableHeaderRename.submitRename,
      tableHeaderRename.cancelRename,
      hasTableData,
      handleStartTableRename,
      handleShowDeleteTableConfirm,
    ]
  )

  const createTrigger = useMemo(
    () =>
      userPermissions.canEdit ? (
        <HeaderAddColumnTrigger onClick={handleAddColumn} disabled={addColumnMutation.isPending} />
      ) : null,
    [handleAddColumn, addColumnMutation.isPending, userPermissions.canEdit]
  )

  const handleExportCsv = useCallback(async () => {
    if (!tableData) return
    try {
      await downloadTableExport(tableData.id, tableData.name)
    } catch (err) {
      logger.error('Failed to export table:', err)
      toast.error('Failed to export table')
    }
  }, [tableData])

  const headerActions = useMemo(
    () =>
      tableData
        ? [
            {
              label: 'Import CSV',
              icon: Upload,
              onClick: () => setIsImportCsvOpen(true),
              disabled: userPermissions.canEdit !== true,
            },
            {
              label: 'Export CSV',
              icon: Download,
              onClick: () => void handleExportCsv(),
              disabled: tableData.rowCount === 0,
            },
          ]
        : undefined,
    [tableData, userPermissions.canEdit, handleExportCsv]
  )

  const activeSortState = useMemo(() => {
    if (!queryOptions.sort) return null
    const entries = Object.entries(queryOptions.sort)
    if (entries.length === 0) return null
    const [column, direction] = entries[0]
    return { column, direction }
  }, [queryOptions.sort])

  const sortConfig = useMemo<SortConfig>(
    () => ({
      options: columnOptions,
      active: activeSortState,
      onSort: handleSortChange,
      onClear: handleSortClear,
    }),
    [columnOptions, activeSortState, handleSortChange, handleSortClear]
  )

  const selectedRowCount = useMemo(() => {
    if (!contextMenu.isOpen || !contextMenu.row) return 1

    if (checkedRows.size > 0 && checkedRows.has(contextMenu.row.position)) {
      let count = 0
      for (const pos of checkedRows) {
        if (positionMap.has(pos)) count++
      }
      return Math.max(count, 1)
    }

    const sel = normalizedSelection
    if (!sel) return 1

    const isInSelection =
      contextMenu.row.position >= sel.startRow && contextMenu.row.position <= sel.endRow

    if (!isInSelection) return 1

    let count = 0
    for (let r = sel.startRow; r <= sel.endRow; r++) {
      if (positionMap.has(r)) count++
    }
    return Math.max(count, 1)
  }, [contextMenu.isOpen, contextMenu.row, checkedRows, normalizedSelection, positionMap])

  const pendingUpdate = updateRowMutation.isPending ? updateRowMutation.variables : null

  const workflowColumnNames = useMemo(
    () => columns.filter((c) => !!c.workflowGroupId).map((c) => c.name),
    [columns]
  )
  const hasWorkflowColumns = workflowColumnNames.length > 0

  const { runningByRowId, totalRunning } = useMemo(() => {
    const byRow = new Map<string, number>()
    let total = 0
    for (const row of rows) {
      let count = 0
      const executions = row.executions ?? {}
      for (const gid in executions) {
        if (executions[gid]?.status === 'running') count++
      }
      if (count > 0) {
        byRow.set(row.id, count)
        total += count
      }
    }
    return { runningByRowId: byRow, totalRunning: total }
  }, [rows])

  const cancelRunsMutate = cancelRunsMutation.mutate

  const handleStopAll = useCallback(() => {
    if (totalRunning === 0) return
    cancelRunsMutate({ scope: 'all' })
  }, [totalRunning, cancelRunsMutate])

  const handleStopRow = useCallback(
    (rowId: string) => {
      cancelRunsMutate({ scope: 'row', rowId })
    },
    [cancelRunsMutate]
  )

  const handleRunRow = useCallback(
    (rowId: string) => {
      if (tableWorkflowGroups.length === 0) return
      const target = rowsRef.current.find((r) => r.id === rowId)
      if (!target) return
      // Only fire groups whose deps are already satisfied for THIS row. The
      // cascade picks up downstream groups: when an upstream group completes,
      // `scheduleWorkflowGroupRuns` evaluates eligibility and enqueues the
      // newly-ready successors automatically.
      for (const group of tableWorkflowGroups) {
        if (!areRowDepsSatisfied(group, target)) continue
        void runWorkflowGroup({
          tableId,
          rowId,
          workspaceId,
          groupId: group.id,
          workflowId: group.workflowId,
          outputColumnNames: group.outputs.map((o) => o.columnName),
        })
      }
    },
    [runWorkflowGroup, tableId, workspaceId, tableWorkflowGroups]
  )

  if (!isLoadingTable && !tableData) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <TableX className='h-[32px] w-[32px] text-[var(--text-muted)]' />
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
      {!embedded && (
        <>
          <ResourceHeader
            icon={TableIcon}
            breadcrumbs={breadcrumbs}
            createTrigger={createTrigger}
            actions={headerActions}
            trailingActions={
              totalRunning > 0 ? (
                <RunStatusControl
                  running={totalRunning}
                  onStopAll={handleStopAll}
                  isStopping={cancelRunsMutation.isPending}
                />
              ) : null
            }
          />

          <ResourceOptionsBar
            sort={sortConfig}
            onFilterToggle={handleFilterToggle}
            filterActive={filterOpen || !!queryOptions.filter}
          />
          {filterOpen && (
            <TableFilter
              columns={displayColumns}
              filter={queryOptions.filter}
              onApply={handleFilterApply}
              onClose={handleFilterClose}
            />
          )}
        </>
      )}

      {embedded && totalRunning > 0 && (
        <div className='flex shrink-0 items-center justify-end border-[var(--border)] border-b px-3 py-1.5'>
          <RunStatusControl
            running={totalRunning}
            onStopAll={handleStopAll}
            isStopping={cancelRunsMutation.isPending}
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
              width: `${tableWidth + sidebarReservedPx}px`,
              paddingRight: sidebarReservedPx,
            }}
          >
            <table
              className='table-fixed border-separate border-spacing-0 text-small'
              style={{ width: `${tableWidth}px` }}
            >
              {isLoadingTable ? (
                <colgroup>
                  <col style={{ width: CHECKBOX_COL_WIDTH }} />
                  {Array.from({ length: SKELETON_COL_COUNT }).map((_, i) => (
                    <col key={i} style={{ width: COL_WIDTH }} />
                  ))}
                  <col style={{ width: ADD_COL_WIDTH }} />
                </colgroup>
              ) : (
                <TableColGroup columns={displayColumns} columnWidths={columnWidths} />
              )}
              <thead className='sticky top-0 z-10'>
                {isLoadingTable ? (
                  <tr>
                    <th className={CELL_HEADER_CHECKBOX}>
                      <div className='flex items-center justify-center'>
                        <Skeleton className='h-[14px] w-[14px] rounded-xs' />
                      </div>
                    </th>
                    {Array.from({ length: SKELETON_COL_COUNT }).map((_, i) => (
                      <th key={i} className={CELL_HEADER}>
                        <div className='flex h-[20px] min-w-0 items-center gap-1.5'>
                          <Skeleton className='h-[14px] w-[14px] shrink-0 rounded-xs' />
                          <Skeleton className='h-[14px]' style={{ width: `${56 + i * 16}px` }} />
                        </div>
                      </th>
                    ))}
                    <th className={CELL_HEADER}>
                      <div className='flex h-[20px] items-center gap-2'>
                        <Skeleton className='h-[14px] w-[14px] shrink-0 rounded-xs' />
                        <Skeleton className='h-[14px] w-[72px]' />
                      </div>
                    </th>
                  </tr>
                ) : (
                  <>
                    {hasWorkflowGroup && (
                      <tr>
                        <th className='border-[var(--border)] border-b bg-[var(--bg)] px-1 py-[5px]' />
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
                              onOpenConfig={handleConfigureColumn}
                              onRunGroup={userPermissions.canEdit ? handleRunGroup : undefined}
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
                        />
                      ))}
                      {userPermissions.canEdit && (
                        <AddColumnButton
                          onClick={handleAddColumn}
                          disabled={addColumnMutation.isPending}
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
                    {rows.map((row, index) => {
                      const prevPosition = index > 0 ? rows[index - 1].position : -1
                      const gapCount =
                        queryOptions.filter || queryOptions.sort
                          ? 0
                          : row.position - prevPosition - 1
                      return (
                        <React.Fragment key={row.id}>
                          {gapCount > 0 && (
                            <PositionGapRows
                              count={gapCount}
                              startPosition={prevPosition + 1}
                              columns={displayColumns}
                              normalizedSelection={normalizedSelection}
                              checkedRows={checkedRows}
                              firstRowUnderHeader={prevPosition === -1}
                              onCellMouseDown={handleCellMouseDown}
                              onCellMouseEnter={handleCellMouseEnter}
                              onRowToggle={handleRowToggle}
                            />
                          )}
                          <DataRow
                            row={row}
                            columns={displayColumns}
                            rowIndex={row.position}
                            isFirstRow={row.position === 0}
                            editingColumnName={
                              editingCell?.rowId === row.id ? editingCell.columnName : null
                            }
                            initialCharacter={
                              editingCell?.rowId === row.id ? initialCharacter : null
                            }
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
                            isRowChecked={checkedRows.has(row.position)}
                            onRowToggle={handleRowToggle}
                            runningCount={runningByRowId.get(row.id) ?? 0}
                            hasWorkflowColumns={hasWorkflowColumns}
                            onStopRow={handleStopRow}
                            onRunRow={handleRunRow}
                            workflowNameById={workflowNameById}
                          />
                        </React.Fragment>
                      )
                    })}
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

        <ColumnSidebar
          configState={configState}
          onClose={() => setConfigState(null)}
          existingColumn={
            configState?.mode === 'edit'
              ? (columns.find((c) => c.name === configState.columnName) ?? null)
              : null
          }
          allColumns={columns}
          workflowGroups={tableWorkflowGroups}
          workflows={workflows}
          workspaceId={workspaceId}
          tableId={tableId}
        />

        <ExecutionDetailsSidebar
          workspaceId={workspaceId}
          executionId={executionDetailsId}
          onClose={() => setExecutionDetailsId(null)}
        />
      </div>

      {editingRow && tableData && (
        <RowModal
          mode='edit'
          isOpen={true}
          onClose={() => setEditingRow(null)}
          table={tableData}
          row={editingRow}
          onSuccess={() => setEditingRow(null)}
        />
      )}

      {deletingRows.length > 0 && tableData && (
        <RowModal
          mode='delete'
          isOpen={true}
          onClose={() => setDeletingRows([])}
          table={tableData}
          rowIds={deletingRows.map((r) => r.rowId)}
          onSuccess={() => {
            pushUndo({ type: 'delete-rows', rows: deletingRows })
            setDeletingRows([])
            handleClearSelection()
          }}
        />
      )}

      <ContextMenu
        contextMenu={contextMenu}
        onClose={closeContextMenu}
        onEditCell={handleContextMenuEditCell}
        onDelete={handleContextMenuDelete}
        onInsertAbove={handleInsertRowAbove}
        onInsertBelow={handleInsertRowBelow}
        onDuplicate={handleDuplicateRow}
        onViewExecution={handleViewExecution}
        canViewExecution={Boolean(contextMenuExecutionId)}
        canEditCell={!contextMenuIsWorkflowColumn}
        selectedRowCount={selectedRowCount}
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

      {!embedded && (
        <Modal open={showDeleteTableConfirm} onOpenChange={setShowDeleteTableConfirm}>
          <ModalContent size='sm'>
            <ModalHeader>Delete Table</ModalHeader>
            <ModalBody>
              <p className='text-[var(--text-secondary)]'>
                Are you sure you want to delete{' '}
                <span className='font-medium text-[var(--text-primary)]'>{tableData?.name}</span>?{' '}
                <span className='text-[var(--text-error)]'>
                  All {tableData?.rowCount ?? 0} rows will be removed.
                </span>{' '}
                You can restore it from Recently Deleted in Settings.
              </p>
            </ModalBody>
            <ModalFooter>
              <Button
                variant='default'
                onClick={() => setShowDeleteTableConfirm(false)}
                disabled={deleteTableMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={handleDeleteTable}
                disabled={deleteTableMutation.isPending}
              >
                {deleteTableMutation.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {tableData && (
        <ImportCsvDialog
          open={isImportCsvOpen}
          onOpenChange={setIsImportCsvOpen}
          workspaceId={workspaceId}
          table={tableData}
        />
      )}

      <Modal
        open={deletingColumns !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingColumns(null)
        }}
      >
        <ModalContent size='sm'>
          <ModalHeader>
            {deletingColumns && deletingColumns.length > 1
              ? `Delete ${deletingColumns.length} Columns`
              : 'Delete Column'}
          </ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              {deletingColumns && deletingColumns.length > 1 ? (
                <>
                  Are you sure you want to delete{' '}
                  <span className='font-medium text-[var(--text-primary)]'>
                    {deletingColumns.length} columns
                  </span>
                  ?{' '}
                </>
              ) : (
                <>
                  Are you sure you want to delete{' '}
                  <span className='font-medium text-[var(--text-primary)]'>
                    {deletingColumns?.[0]}
                  </span>
                  ?{' '}
                </>
              )}
              <span className='text-[var(--text-error)]'>
                This will remove all data in{' '}
                {deletingColumns && deletingColumns.length > 1 ? 'these columns' : 'this column'}.
              </span>{' '}
              You can undo this action.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setDeletingColumns(null)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDeleteColumnConfirm}>
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

const GAP_ROW_LIMIT = 200
const GAP_CHECKBOX_CLASS = cn(CELL_CHECKBOX, 'cursor-pointer')

interface PositionGapRowsProps {
  count: number
  startPosition: number
  columns: DisplayColumn[]
  normalizedSelection: NormalizedSelection | null
  checkedRows: Set<number>
  firstRowUnderHeader?: boolean
  onCellMouseDown: (rowIndex: number, colIndex: number, shiftKey: boolean) => void
  onCellMouseEnter: (rowIndex: number, colIndex: number) => void
  onRowToggle: (rowIndex: number, shiftKey: boolean) => void
}

const PositionGapRows = React.memo(
  function PositionGapRows({
    count,
    startPosition,
    columns,
    normalizedSelection,
    checkedRows,
    firstRowUnderHeader = false,
    onCellMouseDown,
    onCellMouseEnter,
    onRowToggle,
  }: PositionGapRowsProps) {
    const capped = Math.min(count, GAP_ROW_LIMIT)
    const sel = normalizedSelection
    const isMultiCell = sel !== null && (sel.startRow !== sel.endRow || sel.startCol !== sel.endCol)

    return (
      <>
        {Array.from({ length: capped }).map((_, i) => {
          const position = startPosition + i
          const isGapChecked = checkedRows.has(position)
          return (
            <tr key={`gap-${position}`}>
              <td className={GAP_CHECKBOX_CLASS}>
                <div className='flex items-center justify-center gap-1'>
                  <div
                    className='group/checkbox flex h-[20px] w-[24px] shrink-0 items-center justify-center'
                    onMouseDown={(e) => {
                      if (e.button !== 0) return
                      onRowToggle(position, e.shiftKey)
                    }}
                  >
                    <span
                      className={cn(
                        'text-[var(--text-tertiary)] text-xs tabular-nums',
                        isGapChecked ? 'hidden' : 'block group-hover/checkbox:hidden'
                      )}
                    >
                      {position + 1}
                    </span>
                    <div
                      className={cn(
                        'items-center justify-center',
                        isGapChecked ? 'flex' : 'hidden group-hover/checkbox:flex'
                      )}
                    >
                      <Checkbox size='sm' checked={isGapChecked} className='pointer-events-none' />
                    </div>
                  </div>
                </div>
              </td>
              {columns.map((col, colIndex) => {
                const inRange =
                  sel !== null &&
                  position >= sel.startRow &&
                  position <= sel.endRow &&
                  colIndex >= sel.startCol &&
                  colIndex <= sel.endCol
                const isAnchor =
                  sel !== null && position === sel.anchorRow && colIndex === sel.anchorCol
                const isHighlighted = inRange || isGapChecked

                const isTopEdge = inRange ? position === sel!.startRow : isGapChecked
                const isBottomEdge = inRange ? position === sel!.endRow : isGapChecked
                const isLeftEdge = inRange ? colIndex === sel!.startCol : colIndex === 0
                const isRightEdge = inRange
                  ? colIndex === sel!.endCol
                  : colIndex === columns.length - 1
                const belowHeader = firstRowUnderHeader && i === 0

                return (
                  <td
                    key={col.key}
                    data-row={position}
                    data-col={colIndex}
                    className={cn(CELL, (isHighlighted || isAnchor) && 'relative')}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return
                      onCellMouseDown(position, colIndex, e.shiftKey)
                    }}
                    onMouseEnter={() => onCellMouseEnter(position, colIndex)}
                  >
                    {isHighlighted && (isMultiCell || isGapChecked) && (
                      <div
                        className={cn(
                          '-top-px -right-px -bottom-px -left-px pointer-events-none absolute z-[4]',
                          SELECTION_TINT_BG,
                          belowHeader && isTopEdge && 'top-0',
                          isTopEdge && 'border-t border-t-[var(--selection)]',
                          isBottomEdge && 'border-b border-b-[var(--selection)]',
                          isLeftEdge && 'border-l border-l-[var(--selection)]',
                          isRightEdge && 'border-r border-r-[var(--selection)]'
                        )}
                      />
                    )}
                    {isAnchor && <div className={cn(SELECTION_OVERLAY, belowHeader && 'top-0')} />}
                    <div className='min-h-[20px]' />
                  </td>
                )
              })}
            </tr>
          )
        })}
        {count > GAP_ROW_LIMIT && (
          <tr>
            <td
              colSpan={columns.length + 2}
              className='border-[var(--border)] border-r border-b p-0'
              style={{ height: `${(count - GAP_ROW_LIMIT) * ROW_HEIGHT_ESTIMATE}px` }}
            />
          </tr>
        )}
      </>
    )
  },
  (prev, next) => {
    if (
      prev.count !== next.count ||
      prev.startPosition !== next.startPosition ||
      prev.columns !== next.columns ||
      prev.normalizedSelection !== next.normalizedSelection ||
      prev.firstRowUnderHeader !== next.firstRowUnderHeader ||
      prev.onCellMouseDown !== next.onCellMouseDown ||
      prev.onCellMouseEnter !== next.onCellMouseEnter ||
      prev.onRowToggle !== next.onRowToggle
    ) {
      return false
    }
    const end = prev.startPosition + Math.min(prev.count, GAP_ROW_LIMIT)
    for (let p = prev.startPosition; p < end; p++) {
      if (prev.checkedRows.has(p) !== next.checkedRows.has(p)) return false
    }
    return true
  }
)

const TableColGroup = React.memo(function TableColGroup({
  columns,
  columnWidths,
}: {
  columns: DisplayColumn[]
  columnWidths: Record<string, number>
}) {
  return (
    <colgroup>
      <col style={{ width: CHECKBOX_COL_WIDTH }} />
      {columns.map((col) => (
        <col key={col.key} style={{ width: columnWidths[col.key] ?? COL_WIDTH }} />
      ))}
      <col style={{ width: ADD_COL_WIDTH }} />
    </colgroup>
  )
})

interface DataRowProps {
  row: TableRowType
  columns: DisplayColumn[]
  rowIndex: number
  isFirstRow: boolean
  editingColumnName: string | null
  initialCharacter: string | null
  pendingCellValue: Record<string, unknown> | null
  normalizedSelection: NormalizedSelection | null
  onClick: (rowId: string, columnName: string) => void
  onDoubleClick: (rowId: string, columnName: string, columnKey: string) => void
  onSave: (rowId: string, columnName: string, value: unknown, reason: SaveReason) => void
  onCancel: () => void
  onContextMenu: (e: React.MouseEvent, row: TableRowType) => void
  onCellMouseDown: (rowIndex: number, colIndex: number, shiftKey: boolean) => void
  onCellMouseEnter: (rowIndex: number, colIndex: number) => void
  isRowChecked: boolean
  onRowToggle: (rowIndex: number, shiftKey: boolean) => void
  /** Number of workflow cells in this row currently in a running/queued state. */
  runningCount: number
  /** Whether the table has at least one workflow column — controls whether a run/stop icon is rendered. */
  hasWorkflowColumns: boolean
  onStopRow: (rowId: string) => void
  onRunRow: (rowId: string) => void
  /** Lookup from workflow id → human-readable name, used to label running cells. */
  workflowNameById: Record<string, string>
}

function rowSelectionChanged(
  rowIndex: number,
  colCount: number,
  prev: NormalizedSelection | null,
  next: NormalizedSelection | null
): boolean {
  const pIn = prev !== null && rowIndex >= prev.startRow && rowIndex <= prev.endRow
  const nIn = next !== null && rowIndex >= next.startRow && rowIndex <= next.endRow
  const pAnchor = prev !== null && rowIndex === prev.anchorRow
  const nAnchor = next !== null && rowIndex === next.anchorRow

  if (!pIn && !nIn && !pAnchor && !nAnchor) return false
  if (pIn !== nIn || pAnchor !== nAnchor) return true

  if (pIn && nIn) {
    if (prev!.startCol !== next!.startCol || prev!.endCol !== next!.endCol) return true
    if ((rowIndex === prev!.startRow) !== (rowIndex === next!.startRow)) return true
    if ((rowIndex === prev!.endRow) !== (rowIndex === next!.endRow)) return true
    const pMulti = prev!.startRow !== prev!.endRow || prev!.startCol !== prev!.endCol
    const nMulti = next!.startRow !== next!.endRow || next!.startCol !== next!.endCol
    if (pMulti !== nMulti) return true
    const pFull = prev!.startCol === 0 && prev!.endCol === colCount - 1
    const nFull = next!.startCol === 0 && next!.endCol === colCount - 1
    if (pFull !== nFull) return true
  }

  if (pAnchor && nAnchor && prev!.anchorCol !== next!.anchorCol) return true

  return false
}

function dataRowPropsAreEqual(prev: DataRowProps, next: DataRowProps): boolean {
  if (
    prev.row !== next.row ||
    prev.columns !== next.columns ||
    prev.rowIndex !== next.rowIndex ||
    prev.isFirstRow !== next.isFirstRow ||
    prev.editingColumnName !== next.editingColumnName ||
    prev.pendingCellValue !== next.pendingCellValue ||
    prev.onClick !== next.onClick ||
    prev.onDoubleClick !== next.onDoubleClick ||
    prev.onSave !== next.onSave ||
    prev.onCancel !== next.onCancel ||
    prev.onContextMenu !== next.onContextMenu ||
    prev.onCellMouseDown !== next.onCellMouseDown ||
    prev.onCellMouseEnter !== next.onCellMouseEnter ||
    prev.isRowChecked !== next.isRowChecked ||
    prev.onRowToggle !== next.onRowToggle ||
    prev.runningCount !== next.runningCount ||
    prev.hasWorkflowColumns !== next.hasWorkflowColumns ||
    prev.onStopRow !== next.onStopRow ||
    prev.onRunRow !== next.onRunRow ||
    prev.workflowNameById !== next.workflowNameById
  ) {
    return false
  }
  if (
    (prev.editingColumnName !== null || next.editingColumnName !== null) &&
    prev.initialCharacter !== next.initialCharacter
  ) {
    return false
  }

  return !rowSelectionChanged(
    prev.rowIndex,
    prev.columns.length,
    prev.normalizedSelection,
    next.normalizedSelection
  )
}

const DataRow = React.memo(function DataRow({
  row,
  columns,
  rowIndex,
  isFirstRow,
  editingColumnName,
  initialCharacter,
  pendingCellValue,
  normalizedSelection,
  isRowChecked,
  onClick,
  onDoubleClick,
  onSave,
  onCancel,
  onContextMenu,
  onCellMouseDown,
  onCellMouseEnter,
  onRowToggle,
  runningCount,
  hasWorkflowColumns,
  onStopRow,
  onRunRow,
  workflowNameById,
}: DataRowProps) {
  const sel = normalizedSelection
  const isMultiCell = sel !== null && (sel.startRow !== sel.endRow || sel.startCol !== sel.endCol)
  const isRowSelectedByRange =
    sel !== null &&
    rowIndex >= sel.startRow &&
    rowIndex <= sel.endRow &&
    sel.startCol === 0 &&
    sel.endCol === columns.length - 1
  const isRowSelected = isRowChecked || isRowSelectedByRange

  return (
    <tr onContextMenu={(e) => onContextMenu(e, row)}>
      <td className={cn(CELL_CHECKBOX, 'cursor-pointer')}>
        <div className='flex items-center justify-center gap-1'>
          <div
            className='group/checkbox flex h-[20px] w-[24px] shrink-0 items-center justify-center'
            onMouseDown={(e) => {
              if (e.button !== 0) return
              onRowToggle(rowIndex, e.shiftKey)
            }}
          >
            <span
              className={cn(
                'text-[var(--text-tertiary)] text-xs tabular-nums',
                isRowSelected ? 'hidden' : 'block group-hover/checkbox:hidden'
              )}
            >
              {row.position + 1}
            </span>
            <div
              className={cn(
                'items-center justify-center',
                isRowSelected ? 'flex' : 'hidden group-hover/checkbox:flex'
              )}
            >
              <Checkbox size='sm' checked={isRowSelected} className='pointer-events-none' />
            </div>
          </div>
          {hasWorkflowColumns && (
            <button
              type='button'
              aria-label={runningCount > 0 ? `Stop ${runningCount} running` : 'Run row'}
              title={runningCount > 0 ? `Stop ${runningCount} running` : 'Run row'}
              className='ml-auto flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded text-[var(--text-primary)] transition-colors hover-hover:bg-[var(--surface-2)]'
              onClick={() => {
                if (runningCount > 0) {
                  onStopRow(row.id)
                } else {
                  onRunRow(row.id)
                }
              }}
            >
              {runningCount > 0 ? (
                <Square className='h-[12px] w-[12px]' />
              ) : (
                <PlayOutline className='h-[12px] w-[12px]' />
              )}
            </button>
          )}
        </div>
      </td>
      {columns.map((column, colIndex) => {
        const inRange =
          sel !== null &&
          rowIndex >= sel.startRow &&
          rowIndex <= sel.endRow &&
          colIndex >= sel.startCol &&
          colIndex <= sel.endCol
        const isAnchor = sel !== null && rowIndex === sel.anchorRow && colIndex === sel.anchorCol
        const isEditing = editingColumnName === column.name
        const isHighlighted = inRange || isRowChecked

        const isTopEdge = inRange ? rowIndex === sel!.startRow : isRowChecked
        const isBottomEdge = inRange ? rowIndex === sel!.endRow : isRowChecked
        const isLeftEdge = inRange ? colIndex === sel!.startCol : colIndex === 0
        const isRightEdge = inRange ? colIndex === sel!.endCol : colIndex === columns.length - 1

        return (
          <td
            key={column.key}
            data-row={rowIndex}
            data-col={colIndex}
            className={cn(CELL, (isHighlighted || isAnchor || isEditing) && 'relative')}
            onMouseDown={(e) => {
              if (e.button !== 0 || isEditing) return
              onCellMouseDown(rowIndex, colIndex, e.shiftKey)
            }}
            onMouseEnter={() => onCellMouseEnter(rowIndex, colIndex)}
            onClick={() => onClick(row.id, column.name)}
            onDoubleClick={() => onDoubleClick(row.id, column.name, column.key)}
          >
            {isHighlighted && (isMultiCell || isRowChecked) && (
              <div
                className={cn(
                  '-top-px -right-px -bottom-px -left-px pointer-events-none absolute z-[4]',
                  SELECTION_TINT_BG,
                  isFirstRow && isTopEdge && 'top-0',
                  isTopEdge && 'border-t border-t-[var(--selection)]',
                  isBottomEdge && 'border-b border-b-[var(--selection)]',
                  isLeftEdge && 'border-l border-l-[var(--selection)]',
                  isRightEdge && 'border-r border-r-[var(--selection)]'
                )}
              />
            )}
            {isAnchor && <div className={cn(SELECTION_OVERLAY, isFirstRow && 'top-0')} />}
            <div className={CELL_CONTENT}>
              <CellContent
                value={
                  pendingCellValue && column.name in pendingCellValue
                    ? pendingCellValue[column.name]
                    : row.data[column.name]
                }
                exec={readExecution(row, column.workflowGroupId)}
                column={column}
                isEditing={isEditing}
                initialCharacter={isEditing ? initialCharacter : undefined}
                onSave={(value, reason) => onSave(row.id, column.name, value, reason)}
                onCancel={onCancel}
                workflowNameById={workflowNameById}
              />
            </div>
          </td>
        )
      })}
    </tr>
  )
}, dataRowPropsAreEqual)

const TableBodySkeleton = React.memo(function TableBodySkeleton({
  colCount,
}: {
  colCount: number
}) {
  return (
    <>
      {Array.from({ length: SKELETON_ROW_COUNT }).map((_, rowIndex) => (
        <tr key={rowIndex}>
          <td className={cn(CELL_CHECKBOX, 'text-center')}>
            <div className='flex min-h-[20px] items-center justify-center'>
              <span className='text-[var(--text-tertiary)] text-xs tabular-nums'>
                {rowIndex + 1}
              </span>
            </div>
          </td>
          {Array.from({ length: colCount }).map((_, colIndex) => {
            const width = 72 + ((rowIndex + colIndex) % 4) * 24
            return (
              <td key={colIndex} className={CELL}>
                <div className='flex min-h-[20px] items-center'>
                  <Skeleton className='h-[16px]' style={{ width: `${width}px` }} />
                </div>
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
})

interface RunStatusControlProps {
  running: number
  onStopAll: () => void
  isStopping: boolean
}

/**
 * Run-status + Stop-all control rendered in the header's trailing actions row.
 * Matches the in-cell running indicator (`Loader` + tertiary text) for consistency.
 */
const RunStatusControl = React.memo(function RunStatusControl({
  running,
  onStopAll,
  isStopping,
}: RunStatusControlProps) {
  return (
    <div className='flex items-center gap-1.5'>
      <div className='flex items-center gap-1.5 px-1 text-[var(--text-tertiary)] text-caption'>
        <Loader animate className='h-3.5 w-3.5 shrink-0' />
        <span className='tabular-nums'>{running}</span>
        <span>running</span>
      </div>
      <Button
        variant='subtle'
        className='px-2 py-1 text-caption'
        onClick={onStopAll}
        disabled={isStopping}
      >
        <Square className='mr-1.5 h-[14px] w-[14px] fill-current' />
        Stop all
      </Button>
    </div>
  )
})

const SelectAllCheckbox = React.memo(function SelectAllCheckbox({
  checked,
  onCheckedChange,
}: {
  checked: boolean
  onCheckedChange: () => void
}) {
  return (
    <th className={CELL_HEADER_CHECKBOX}>
      <div className='flex items-center justify-center'>
        <Checkbox size='sm' checked={checked} onCheckedChange={onCheckedChange} />
      </div>
    </th>
  )
})

const AddColumnButton = React.memo(function AddColumnButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled: boolean
}) {
  return (
    <th className={CELL_HEADER}>
      <button
        type='button'
        className='flex h-[20px] cursor-pointer items-center gap-2 outline-none'
        disabled={disabled}
        onClick={onClick}
      >
        <Plus className='h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
        <span className='font-medium text-[var(--text-body)] text-small'>New column</span>
      </button>
    </th>
  )
})

const HEADER_ADD_COLUMN_ICON = <Plus className='mr-1.5 h-[14px] w-[14px] text-[var(--text-icon)]' />

function HeaderAddColumnTrigger({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <Button
      variant='subtle'
      className='px-2 py-1 text-caption'
      disabled={disabled}
      onClick={onClick}
    >
      {HEADER_ADD_COLUMN_ICON}
      New column
    </Button>
  )
}

const AddRowButton = React.memo(function AddRowButton({ onClick }: { onClick: () => void }) {
  return (
    <div className='px-2 py-[7px]'>
      <button
        type='button'
        className='flex h-[20px] cursor-pointer items-center gap-2'
        onClick={onClick}
      >
        <Plus className='h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
        <span className='font-medium text-[var(--text-body)] text-small'>New row</span>
      </button>
    </div>
  )
})

/**
 * Reuses the logs page's `LogDetails` slideout inside the tables view so a user
 * can inspect a workflow run for a cell without leaving the table. The query is
 * keyed on `executionId` because that's what's stored on the cell.
 */
function ExecutionDetailsSidebar({
  workspaceId,
  executionId,
  onClose,
}: {
  workspaceId: string
  executionId: string | null
  onClose: () => void
}) {
  const { data: log } = useLogByExecutionId(workspaceId, executionId)
  return <LogDetails log={log ?? null} isOpen={Boolean(executionId)} onClose={onClose} />
}
