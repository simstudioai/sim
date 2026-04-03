'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import {
  Button,
  Checkbox,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
} from '@/components/emcn'
import {
  ArrowLeft,
  ArrowRight,
  Calendar as CalendarIcon,
  ChevronDown,
  Fingerprint,
  Pencil,
  Plus,
  Table as TableIcon,
  TableX,
  Trash,
  TypeBoolean,
  TypeJson,
  TypeNumber,
  TypeText,
} from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import { captureEvent } from '@/lib/posthog/client'
import type { ColumnDefinition, Filter, SortDirection, TableRow as TableRowType } from '@/lib/table'
import type { ColumnOption, SortConfig } from '@/app/workspace/[workspaceId]/components'
import { ResourceHeader, ResourceOptionsBar } from '@/app/workspace/[workspaceId]/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  useAddTableColumn,
  useBatchCreateTableRows,
  useBatchUpdateTableRows,
  useCreateTableRow,
  useDeleteColumn,
  useDeleteTable,
  useRenameTable,
  useUpdateColumn,
  useUpdateTableMetadata,
  useUpdateTableRow,
} from '@/hooks/queries/tables'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { extractCreatedRowId, useTableUndo } from '@/hooks/use-table-undo'
import type { DeletedRowSnapshot } from '@/stores/table/types'
import { useContextMenu, useTableData } from '../../hooks'
import type { EditingCell, QueryOptions, SaveReason } from '../../types'
import {
  cleanCellValue,
  displayToStorage,
  formatValueForInput,
  storageToDisplay,
} from '../../utils'
import { ContextMenu } from '../context-menu'
import { RowModal } from '../row-modal'
import { TableFilter } from '../table-filter'

interface CellCoord {
  rowIndex: number
  colIndex: number
}

interface NormalizedSelection {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
  anchorRow: number
  anchorCol: number
}

const EMPTY_COLUMNS: never[] = []
const EMPTY_CHECKED_ROWS = new Set<number>()
const COL_WIDTH = 160
const COL_WIDTH_MIN = 80
const CHECKBOX_COL_WIDTH = 40
const ADD_COL_WIDTH = 120
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

function moveCell(
  anchor: CellCoord,
  colCount: number,
  totalRows: number,
  direction: 1 | -1
): CellCoord {
  let newCol = anchor.colIndex + direction
  let newRow = anchor.rowIndex
  if (newCol >= colCount) {
    newCol = 0
    newRow = Math.min(totalRows - 1, newRow + 1)
  } else if (newCol < 0) {
    newCol = colCount - 1
    newRow = Math.max(0, newRow - 1)
  }
  return { rowIndex: newRow, colIndex: newCol }
}

const COLUMN_TYPE_ICONS: Record<string, React.ElementType> = {
  string: TypeText,
  number: TypeNumber,
  boolean: TypeBoolean,
  date: CalendarIcon,
  json: TypeJson,
}

function computeNormalizedSelection(
  anchor: CellCoord | null,
  focus: CellCoord | null
): NormalizedSelection | null {
  if (!anchor) return null
  const f = focus ?? anchor
  return {
    startRow: Math.min(anchor.rowIndex, f.rowIndex),
    endRow: Math.max(anchor.rowIndex, f.rowIndex),
    startCol: Math.min(anchor.colIndex, f.colIndex),
    endCol: Math.max(anchor.colIndex, f.colIndex),
    anchorRow: anchor.rowIndex,
    anchorCol: anchor.colIndex,
  }
}

function collectRowSnapshots(
  positions: Iterable<number>,
  positionMap: Map<number, TableRowType>
): DeletedRowSnapshot[] {
  const snapshots: DeletedRowSnapshot[] = []
  for (const pos of positions) {
    const row = positionMap.get(pos)
    if (row) {
      snapshots.push({ rowId: row.id, data: { ...row.data }, position: row.position })
    }
  }
  return snapshots
}

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
  const [selectionAnchor, setSelectionAnchor] = useState<CellCoord | null>(null)
  const [selectionFocus, setSelectionFocus] = useState<CellCoord | null>(null)
  const [checkedRows, setCheckedRows] = useState(EMPTY_CHECKED_ROWS)
  const lastCheckboxRowRef = useRef<number | null>(null)
  const [showDeleteTableConfirm, setShowDeleteTableConfirm] = useState(false)
  const [deletingColumn, setDeletingColumn] = useState<string | null>(null)

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

  const { tableData, isLoadingTable, rows, isLoadingRows } = useTableData({
    workspaceId,
    tableId,
    queryOptions,
  })

  const userPermissions = useUserPermissionsContext()
  const canEditRef = useRef(userPermissions.canEdit)
  canEditRef.current = userPermissions.canEdit

  const {
    contextMenu,
    handleRowContextMenu: baseHandleRowContextMenu,
    closeContextMenu,
  } = useContextMenu()

  const updateRowMutation = useUpdateTableRow({ workspaceId, tableId })
  const createRowMutation = useCreateTableRow({ workspaceId, tableId })
  const batchCreateRowsMutation = useBatchCreateTableRows({ workspaceId, tableId })
  const batchUpdateRowsMutation = useBatchUpdateTableRows({ workspaceId, tableId })
  const addColumnMutation = useAddTableColumn({ workspaceId, tableId })
  const updateColumnMutation = useUpdateColumn({ workspaceId, tableId })
  const deleteColumnMutation = useDeleteColumn({ workspaceId, tableId })
  const updateMetadataMutation = useUpdateTableMetadata({ workspaceId, tableId })

  const { pushUndo, undo, redo } = useTableUndo({ workspaceId, tableId })
  const undoRef = useRef(undo)
  undoRef.current = undo
  const redoRef = useRef(redo)
  redoRef.current = redo
  const pushUndoRef = useRef(pushUndo)
  pushUndoRef.current = pushUndo

  const columns = useMemo(
    () => tableData?.schema?.columns || EMPTY_COLUMNS,
    [tableData?.schema?.columns]
  )

  const displayColumns = useMemo(() => {
    if (!columnOrder || columnOrder.length === 0) return columns
    const colMap = new Map(columns.map((c) => [c.name, c]))
    const ordered: ColumnDefinition[] = []
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
    return ordered
  }, [columns, columnOrder])

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
      : displayColumns.reduce((sum, col) => sum + (columnWidths[col.name] ?? COL_WIDTH), 0)
    return CHECKBOX_COL_WIDTH + colsWidth + ADD_COL_WIDTH
  }, [isLoadingTable, displayColCount, displayColumns, columnWidths])

  const resizeIndicatorLeft = useMemo(() => {
    if (!resizingColumn) return 0
    let left = CHECKBOX_COL_WIDTH
    for (const col of displayColumns) {
      left += columnWidths[col.name] ?? COL_WIDTH
      if (col.name === resizingColumn) return left
    }
    return 0
  }, [resizingColumn, displayColumns, columnWidths])

  const dropIndicatorLeft = useMemo(() => {
    if (!dropTargetColumnName) return null
    let left = CHECKBOX_COL_WIDTH
    for (const col of displayColumns) {
      if (dropSide === 'left' && col.name === dropTargetColumnName) return left
      left += columnWidths[col.name] ?? COL_WIDTH
      if (dropSide === 'right' && col.name === dropTargetColumnName) return left
    }
    return null
  }, [dropTargetColumnName, dropSide, displayColumns, columnWidths])

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
  const rowsRef = useRef(rows)
  const selectionAnchorRef = useRef(selectionAnchor)
  const selectionFocusRef = useRef(selectionFocus)

  const checkedRowsRef = useRef(checkedRows)
  checkedRowsRef.current = checkedRows

  columnsRef.current = displayColumns
  schemaColumnsRef.current = columns
  rowsRef.current = rows
  selectionAnchorRef.current = selectionAnchor
  selectionFocusRef.current = selectionFocus

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
      let updatedWidths = columnWidthsRef.current
      if (columnName in updatedWidths) {
        const { [columnName]: width, ...rest } = updatedWidths
        updatedWidths = { ...rest, [newName]: width }
        setColumnWidths(updatedWidths)
      }
      const updatedOrder = columnOrderRef.current?.map((n) => (n === columnName ? newName : n))
      if (updatedOrder) setColumnOrder(updatedOrder)
      updateMetadataRef.current({
        columnWidths: updatedWidths,
        columnOrder: updatedOrder,
      })
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
  }, [deleteTableMutation, tableId, router, workspaceId])

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

  const handleAppendRow = useCallback(() => {
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
          setSelectionAnchor({ rowIndex, colIndex })
          setSelectionFocus(null)
          columnName =
            colIndex < columnsRef.current.length ? columnsRef.current[colIndex].name : null
        }
      }
      baseHandleRowContextMenu(e, row, columnName)
    },
    [baseHandleRowContextMenu]
  )

  const handleCellMouseDown = useCallback(
    (rowIndex: number, colIndex: number, shiftKey: boolean) => {
      setCheckedRows((prev) => (prev.size === 0 ? prev : EMPTY_CHECKED_ROWS))
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
    lastCheckboxRowRef.current = null
  }, [])

  const handleSelectAllRows = useCallback(() => {
    const rws = rowsRef.current
    if (rws.length === 0) return
    setEditingCell(null)
    setSelectionAnchor(null)
    setSelectionFocus(null)
    const all = new Set<number>()
    for (const row of rws) {
      all.add(row.position)
    }
    setCheckedRows(all)
    scrollRef.current?.focus({ preventScroll: true })
  }, [])

  const handleSelectAllToggle = useCallback(() => {
    if (isAllRowsSelectedRef.current) {
      handleClearSelection()
    } else {
      handleSelectAllRows()
    }
  }, [handleClearSelection, handleSelectAllRows])

  const handleColumnResizeStart = useCallback((columnName: string) => {
    setResizingColumn(columnName)
  }, [])

  const handleColumnResize = useCallback((columnName: string, width: number) => {
    setColumnWidths((prev) => ({ ...prev, [columnName]: Math.max(COL_WIDTH_MIN, width) }))
  }, [])

  const handleColumnResizeEnd = useCallback(() => {
    setResizingColumn(null)
    updateMetadataRef.current({ columnWidths: columnWidthsRef.current })
  }, [])

  const handleColumnDragStart = useCallback((columnName: string) => {
    setDragColumnName(columnName)
  }, [])

  const handleColumnDragOver = useCallback((columnName: string, side: 'left' | 'right') => {
    if (columnName === dropTargetColumnNameRef.current && side === dropSideRef.current) return
    setDropTargetColumnName(columnName)
    setDropSide(side)
  }, [])

  const handleColumnDragEnd = useCallback(() => {
    const dragged = dragColumnNameRef.current
    if (!dragged) return
    const target = dropTargetColumnNameRef.current
    const side = dropSideRef.current
    if (target && dragged !== target) {
      const cols = columnsRef.current
      const currentOrder = columnOrderRef.current ?? cols.map((c) => c.name)
      const fromIndex = currentOrder.indexOf(dragged)
      const toIndex = currentOrder.indexOf(target)
      if (fromIndex !== -1 && toIndex !== -1) {
        const newOrder = currentOrder.filter((n) => n !== dragged)
        let insertIndex = newOrder.indexOf(target)
        if (side === 'right') insertIndex += 1
        newOrder.splice(insertIndex, 0, dragged)
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

  useEffect(() => {
    if (!tableData?.metadata || metadataSeededRef.current) return
    if (!tableData.metadata.columnWidths && !tableData.metadata.columnOrder) return
    metadataSeededRef.current = true
    if (tableData.metadata.columnWidths) {
      setColumnWidths(tableData.metadata.columnWidths)
    }
    if (tableData.metadata.columnOrder) {
      setColumnOrder(tableData.metadata.columnOrder)
    }
  }, [tableData?.metadata])

  useEffect(() => {
    const handleMouseUp = () => {
      isDraggingRef.current = false
    }
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [])

  useEffect(() => {
    if (!selectionAnchor) return
    const { rowIndex, colIndex } = selectionAnchor
    const rafId = requestAnimationFrame(() => {
      const cell = document.querySelector(
        `[data-table-scroll] [data-row="${rowIndex}"][data-col="${colIndex}"]`
      ) as HTMLElement | null
      cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => cancelAnimationFrame(rafId)
  }, [selectionAnchor])

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

  const handleCellDoubleClick = useCallback((rowId: string, columnName: string) => {
    if (!canEditRef.current) return
    const column = columnsRef.current.find((c) => c.name === columnName)
    if (!column || column.type === 'boolean') return

    setSelectionFocus(null)
    setEditingCell({ rowId, columnName })
    setInitialCharacter(null)
  }, [])

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
        setSelectionAnchor(null)
        setSelectionFocus(null)
        setCheckedRows((prev) => (prev.size === 0 ? prev : EMPTY_CHECKED_ROWS))
        lastCheckboxRowRef.current = null
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault()
        const rws = rowsRef.current
        if (rws.length > 0) {
          setEditingCell(null)
          setSelectionAnchor(null)
          setSelectionFocus(null)
          const all = new Set<number>()
          for (const row of rws) {
            all.add(row.position)
          }
          setCheckedRows(all)
        }
        return
      }

      if (e.key === ' ' && e.shiftKey) {
        const a = selectionAnchorRef.current
        if (!a || editingCellRef.current) return
        e.preventDefault()
        setSelectionFocus(null)
        setCheckedRows((prev) => {
          const next = new Set(prev)
          if (next.has(a.rowIndex)) {
            next.delete(a.rowIndex)
          } else {
            next.add(a.rowIndex)
          }
          return next
        })
        lastCheckboxRowRef.current = a.rowIndex
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
          mutateRef.current({ rowId: row.id, data: updates })
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
        lastCheckboxRowRef.current = null
        setSelectionAnchor(moveCell(anchor, cols.length, totalRows, e.shiftKey ? -1 : 1))
        setSelectionFocus(null)
        return
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        setCheckedRows((prev) => (prev.size === 0 ? prev : EMPTY_CHECKED_ROWS))
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

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!canEditRef.current) return
        e.preventDefault()
        const sel = computeNormalizedSelection(anchor, selectionFocusRef.current)
        if (!sel) return
        const pMap = positionMapRef.current
        const undoCells: Array<{ rowId: string; data: Record<string, unknown> }> = []
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
          mutateRef.current({ rowId: row.id, data: updates })
        }
        if (undoCells.length > 0) {
          pushUndoRef.current({ type: 'clear-cells', cells: undoCells })
        }
        return
      }

      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!canEditRef.current) return
        const col = cols[anchor.colIndex]
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
          mutateRef.current({ rowId: row.id, data: updates })
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
          mutateRef.current({ rowId: row.id, data: updates })
        }
        e.clipboardData?.setData('text/plain', lines.join('\n'))
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

      const oldValue = row.data[columnName]
      const changed = !(oldValue === value) && !(oldValue === null && value === null)

      if (changed) {
        pushUndoRef.current({
          type: 'update-cell',
          rowId,
          columnName,
          previousValue: oldValue ?? null,
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
    const name = generateColumnName()
    const position = schemaColumnsRef.current.length
    addColumnMutation.mutate(
      { name, type: 'string' },
      {
        onSuccess: () => {
          pushUndoRef.current({ type: 'create-column', columnName: name, position })
        },
      }
    )
  }, [generateColumnName])

  const handleChangeType = useCallback((columnName: string, newType: string) => {
    const column = columnsRef.current.find((c) => c.name === columnName)
    if (column) {
      pushUndoRef.current({
        type: 'update-column-type',
        columnName,
        previousType: column.type,
        newType,
      })
    }
    updateColumnMutation.mutate({ columnName, updates: { type: newType } })
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

  const handleToggleUnique = useCallback((columnName: string) => {
    const column = columnsRef.current.find((c) => c.name === columnName)
    if (!column) return
    const previousValue = !!column.unique
    pushUndoRef.current({
      type: 'toggle-column-constraint',
      columnName,
      constraint: 'unique',
      previousValue,
      newValue: !previousValue,
    })
    updateColumnMutation.mutate({ columnName, updates: { unique: !previousValue } })
  }, [])

  const handleRenameColumn = useCallback(
    (name: string) => columnRename.startRename(name, name),
    [columnRename.startRename]
  )

  const handleDeleteColumn = useCallback((columnName: string) => {
    setDeletingColumn(columnName)
  }, [])

  const handleDeleteColumnConfirm = useCallback(() => {
    if (!deletingColumn) return
    const columnToDelete = deletingColumn
    const orderAtDelete = columnOrderRef.current
    setDeletingColumn(null)
    deleteColumnMutation.mutate(columnToDelete, {
      onSuccess: () => {
        if (!orderAtDelete) return
        const newOrder = orderAtDelete.filter((n) => n !== columnToDelete)
        setColumnOrder(newOrder)
        updateMetadataRef.current({
          columnWidths: columnWidthsRef.current,
          columnOrder: newOrder,
        })
      },
    })
  }, [deletingColumn])

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

  const createAction = useMemo(
    () => ({
      label: 'New column',
      onClick: handleAddColumn,
      disabled: addColumnMutation.isPending,
    }),
    [handleAddColumn, addColumnMutation.isPending]
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
          <ResourceHeader icon={TableIcon} breadcrumbs={breadcrumbs} create={createAction} />

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

      <div
        ref={scrollRef}
        tabIndex={-1}
        className={cn(
          'min-h-0 flex-1 overflow-auto overscroll-none outline-none',
          resizingColumn && 'select-none'
        )}
        data-table-scroll
      >
        <div className='relative h-fit' style={{ width: `${tableWidth}px` }}>
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
                <tr>
                  <SelectAllCheckbox
                    checked={isAllRowsSelected}
                    onCheckedChange={handleSelectAllToggle}
                  />
                  {displayColumns.map((column) => (
                    <ColumnHeaderMenu
                      key={column.name}
                      column={column}
                      readOnly={!userPermissions.canEdit}
                      isRenaming={columnRename.editingId === column.name}
                      renameValue={
                        columnRename.editingId === column.name ? columnRename.editValue : ''
                      }
                      onRenameValueChange={columnRename.setEditValue}
                      onRenameSubmit={columnRename.submitRename}
                      onRenameCancel={columnRename.cancelRename}
                      onRenameColumn={handleRenameColumn}
                      onChangeType={handleChangeType}
                      onInsertLeft={handleInsertColumnLeft}
                      onInsertRight={handleInsertColumnRight}
                      onToggleUnique={handleToggleUnique}
                      onDeleteColumn={handleDeleteColumn}
                      onResizeStart={handleColumnResizeStart}
                      onResize={handleColumnResize}
                      onResizeEnd={handleColumnResizeEnd}
                      isDragging={dragColumnName === column.name}
                      onDragStart={handleColumnDragStart}
                      onDragOver={handleColumnDragOver}
                      onDragEnd={handleColumnDragEnd}
                      onDragLeave={handleColumnDragLeave}
                    />
                  ))}
                  {userPermissions.canEdit && (
                    <AddColumnButton
                      onClick={handleAddColumn}
                      disabled={addColumnMutation.isPending}
                    />
                  )}
                </tr>
              )}
            </thead>
            <tbody>
              {isLoadingTable || isLoadingRows ? (
                <TableBodySkeleton colCount={displayColCount} />
              ) : (
                <>
                  {rows.map((row, index) => {
                    const prevPosition = index > 0 ? rows[index - 1].position : -1
                    const gapCount = queryOptions.filter ? 0 : row.position - prevPosition - 1
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
                          isRowChecked={checkedRows.has(row.position)}
                          onRowToggle={handleRowToggle}
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
          {dropIndicatorLeft !== null && (
            <div
              className='-translate-x-[1px] pointer-events-none absolute top-0 z-20 h-full w-[2px] bg-[var(--selection)]'
              style={{ left: dropIndicatorLeft }}
            />
          )}
        </div>
        {!isLoadingTable && !isLoadingRows && userPermissions.canEdit && (
          <AddRowButton onClick={handleAppendRow} />
        )}
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
        selectedRowCount={selectedRowCount}
        disableEdit={!userPermissions.canEdit}
        disableInsert={!userPermissions.canEdit}
        disableDelete={!userPermissions.canEdit}
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
                <span className='text-[var(--text-tertiary)]'>
                  You can restore it from Recently Deleted in Settings.
                </span>
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

      <Modal
        open={deletingColumn !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingColumn(null)
        }}
      >
        <ModalContent size='sm'>
          <ModalHeader>Delete Column</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>{deletingColumn}</span>?{' '}
              <span className='text-[var(--text-error)]'>
                This will remove all data in this column.
              </span>{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setDeletingColumn(null)}>
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
const GAP_CHECKBOX_CLASS = cn(CELL_CHECKBOX, 'group/checkbox cursor-pointer text-center')

interface PositionGapRowsProps {
  count: number
  startPosition: number
  columns: ColumnDefinition[]
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
              <td
                className={GAP_CHECKBOX_CLASS}
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
                    key={col.name}
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
                          '-top-px -right-px -bottom-px -left-px pointer-events-none absolute z-[4] bg-[rgba(37,99,235,0.06)]',
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
  columns: ColumnDefinition[]
  columnWidths: Record<string, number>
}) {
  return (
    <colgroup>
      <col style={{ width: CHECKBOX_COL_WIDTH }} />
      {columns.map((col) => (
        <col key={col.name} style={{ width: columnWidths[col.name] ?? COL_WIDTH }} />
      ))}
      <col style={{ width: ADD_COL_WIDTH }} />
    </colgroup>
  )
})

interface DataRowProps {
  row: TableRowType
  columns: ColumnDefinition[]
  rowIndex: number
  isFirstRow: boolean
  editingColumnName: string | null
  initialCharacter: string | null
  pendingCellValue: Record<string, unknown> | null
  normalizedSelection: NormalizedSelection | null
  onClick: (rowId: string, columnName: string) => void
  onDoubleClick: (rowId: string, columnName: string) => void
  onSave: (rowId: string, columnName: string, value: unknown, reason: SaveReason) => void
  onCancel: () => void
  onContextMenu: (e: React.MouseEvent, row: TableRowType) => void
  onCellMouseDown: (rowIndex: number, colIndex: number, shiftKey: boolean) => void
  onCellMouseEnter: (rowIndex: number, colIndex: number) => void
  isRowChecked: boolean
  onRowToggle: (rowIndex: number, shiftKey: boolean) => void
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
    prev.onRowToggle !== next.onRowToggle
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
      <td
        className={cn(CELL_CHECKBOX, 'group/checkbox cursor-pointer text-center')}
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
            key={column.name}
            data-row={rowIndex}
            data-col={colIndex}
            className={cn(CELL, (isHighlighted || isAnchor || isEditing) && 'relative')}
            onMouseDown={(e) => {
              if (e.button !== 0 || isEditing) return
              onCellMouseDown(rowIndex, colIndex, e.shiftKey)
            }}
            onMouseEnter={() => onCellMouseEnter(rowIndex, colIndex)}
            onClick={() => onClick(row.id, column.name)}
            onDoubleClick={() => onDoubleClick(row.id, column.name)}
          >
            {isHighlighted && (isMultiCell || isRowChecked) && (
              <div
                className={cn(
                  '-top-px -right-px -bottom-px -left-px pointer-events-none absolute z-[4] bg-[rgba(37,99,235,0.06)]',
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
                column={column}
                isEditing={isEditing}
                initialCharacter={isEditing ? initialCharacter : undefined}
                onSave={(value, reason) => onSave(row.id, column.name, value, reason)}
                onCancel={onCancel}
              />
            </div>
          </td>
        )
      })}
    </tr>
  )
}, dataRowPropsAreEqual)

function CellContent({
  value,
  column,
  isEditing,
  initialCharacter,
  onSave,
  onCancel,
}: {
  value: unknown
  column: ColumnDefinition
  isEditing: boolean
  initialCharacter?: string | null
  onSave: (value: unknown, reason: SaveReason) => void
  onCancel: () => void
}) {
  const isNull = value === null || value === undefined

  let displayContent: React.ReactNode = null
  if (column.type === 'boolean') {
    displayContent = (
      <div
        className={cn('flex min-h-[20px] items-center justify-center', isEditing && 'invisible')}
      >
        <Checkbox size='sm' checked={Boolean(value)} className='pointer-events-none' />
      </div>
    )
  } else if (!isNull && column.type === 'json') {
    displayContent = (
      <span
        className={cn(
          'block overflow-clip text-ellipsis text-[var(--text-primary)]',
          isEditing && 'invisible'
        )}
      >
        {JSON.stringify(value)}
      </span>
    )
  } else if (!isNull && column.type === 'date') {
    displayContent = (
      <span className={cn('text-[var(--text-primary)]', isEditing && 'invisible')}>
        {storageToDisplay(String(value))}
      </span>
    )
  } else if (!isNull) {
    displayContent = (
      <span
        className={cn(
          'block overflow-clip text-ellipsis text-[var(--text-primary)]',
          isEditing && 'invisible'
        )}
      >
        {String(value)}
      </span>
    )
  }

  return (
    <>
      {isEditing && (
        <div className='absolute inset-0 z-10 flex items-start px-0'>
          <InlineEditor
            value={value}
            column={column}
            initialCharacter={initialCharacter ?? undefined}
            onSave={onSave}
            onCancel={onCancel}
          />
        </div>
      )}
      {displayContent}
    </>
  )
}

function InlineDateEditor({
  value,
  column,
  initialCharacter,
  onSave,
  onCancel,
}: {
  value: unknown
  column: ColumnDefinition
  initialCharacter?: string
  onSave: (value: unknown, reason: SaveReason) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const storedValue = formatValueForInput(value, column.type)
  const [draft, setDraft] = useState(() =>
    initialCharacter !== undefined ? initialCharacter : storageToDisplay(storedValue)
  )

  const pickerValue = displayToStorage(draft) || storedValue || undefined

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    if (initialCharacter !== undefined) {
      const len = input.value.length
      input.setSelectionRange(len, len)
    } else {
      input.select()
    }
  }, [])

  useEffect(() => () => clearTimeout(blurTimeoutRef.current), [])

  const doSave = useCallback(
    (reason: SaveReason, storageVal?: string) => {
      if (doneRef.current) return
      doneRef.current = true
      clearTimeout(blurTimeoutRef.current)
      const raw = storageVal ?? displayToStorage(draft) ?? draft
      const val = raw && !Number.isNaN(Date.parse(raw)) ? raw : null
      onSave(val, reason)
    },
    [draft, onSave]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        doSave('enter')
      } else if (e.key === 'Tab') {
        e.preventDefault()
        doSave(e.shiftKey ? 'shift-tab' : 'tab')
      } else if (e.key === 'Escape') {
        e.preventDefault()
        doneRef.current = true
        clearTimeout(blurTimeoutRef.current)
        onCancel()
      }
    },
    [doSave, onCancel]
  )

  const handleBlur = useCallback(() => {
    blurTimeoutRef.current = setTimeout(() => doSave('blur'), 200)
  }, [doSave])

  const handlePickerChange = useCallback(
    (dateStr: string) => {
      clearTimeout(blurTimeoutRef.current)
      doSave('enter', dateStr)
    },
    [doSave]
  )

  const handlePickerOpenChange = useCallback((open: boolean) => {
    if (!open && !doneRef.current) {
      clearTimeout(blurTimeoutRef.current)
      inputRef.current?.focus()
    }
  }, [])

  return (
    <>
      <input
        ref={inputRef}
        type='text'
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder='mm/dd/yyyy'
        className={cn(
          'w-full min-w-0 select-text border-none bg-transparent p-0 text-[var(--text-primary)] text-small outline-none'
        )}
      />
      <div className='absolute top-full left-0 h-0 w-0'>
        <DatePicker
          mode='single'
          value={pickerValue}
          onChange={handlePickerChange}
          open={true}
          onOpenChange={handlePickerOpenChange}
          showTrigger={false}
          size='sm'
        />
      </div>
    </>
  )
}

function InlineTextEditor({
  value,
  column,
  initialCharacter,
  onSave,
  onCancel,
}: {
  value: unknown
  column: ColumnDefinition
  initialCharacter?: string
  onSave: (value: unknown, reason: SaveReason) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(() =>
    initialCharacter !== undefined ? initialCharacter : formatValueForInput(value, column.type)
  )
  const doneRef = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return

    input.focus()
    if (initialCharacter !== undefined) {
      const len = input.value.length
      input.setSelectionRange(len, len)
    } else {
      input.select()
    }

    const forwardWheel = (e: WheelEvent) => {
      e.preventDefault()
      const container = input.closest('[data-table-scroll]') as HTMLElement | null
      if (container) {
        container.scrollBy(e.deltaX, e.deltaY)
      }
    }

    input.addEventListener('wheel', forwardWheel, { passive: false })
    return () => input.removeEventListener('wheel', forwardWheel)
  }, [])

  const doSave = (reason: SaveReason) => {
    if (doneRef.current) return
    doneRef.current = true
    try {
      onSave(cleanCellValue(draft, column), reason)
    } catch {
      onCancel()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      doSave('enter')
    } else if (e.key === 'Tab') {
      e.preventDefault()
      doSave(e.shiftKey ? 'shift-tab' : 'tab')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      doneRef.current = true
      onCancel()
    }
  }

  return (
    <input
      ref={inputRef}
      type='text'
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => doSave('blur')}
      className={cn(
        'w-full min-w-0 select-text border-none bg-transparent p-0 text-[var(--text-primary)] text-small outline-none'
      )}
    />
  )
}

function InlineEditor(props: {
  value: unknown
  column: ColumnDefinition
  initialCharacter?: string
  onSave: (value: unknown, reason: SaveReason) => void
  onCancel: () => void
}) {
  if (props.column.type === 'date') {
    return <InlineDateEditor {...props} />
  }
  return <InlineTextEditor {...props} />
}

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

const COLUMN_TYPE_OPTIONS: { type: string; label: string; icon: React.ElementType }[] = [
  { type: 'string', label: 'Text', icon: TypeText },
  { type: 'number', label: 'Number', icon: TypeNumber },
  { type: 'boolean', label: 'Boolean', icon: TypeBoolean },
  { type: 'date', label: 'Date', icon: CalendarIcon },
  { type: 'json', label: 'JSON', icon: TypeJson },
]

const ColumnHeaderMenu = React.memo(function ColumnHeaderMenu({
  column,
  readOnly,
  isRenaming,
  renameValue,
  onRenameValueChange,
  onRenameSubmit,
  onRenameCancel,
  onRenameColumn,
  onChangeType,
  onInsertLeft,
  onInsertRight,
  onToggleUnique,
  onDeleteColumn,
  onResizeStart,
  onResize,
  onResizeEnd,
  isDragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragLeave,
}: {
  column: ColumnDefinition
  readOnly?: boolean
  isRenaming: boolean
  renameValue: string
  onRenameValueChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  onRenameColumn: (columnName: string) => void
  onChangeType: (columnName: string, newType: string) => void
  onInsertLeft: (columnName: string) => void
  onInsertRight: (columnName: string) => void
  onToggleUnique: (columnName: string) => void
  onDeleteColumn: (columnName: string) => void
  onResizeStart: (columnName: string) => void
  onResize: (columnName: string, width: number) => void
  onResizeEnd: () => void
  isDragging?: boolean
  onDragStart?: (columnName: string) => void
  onDragOver?: (columnName: string, side: 'left' | 'right') => void
  onDragEnd?: () => void
  onDragLeave?: () => void
}) {
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [isRenaming])

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const th = (e.currentTarget as HTMLElement).closest('th')
      const startWidth = th ? th.getBoundingClientRect().width : COL_WIDTH

      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)

      onResizeStart(column.name)

      const handlePointerMove = (ev: PointerEvent) => {
        onResize(column.name, startWidth + (ev.clientX - startX))
      }

      const cleanup = () => {
        target.removeEventListener('pointermove', handlePointerMove)
        target.removeEventListener('pointerup', cleanup)
        target.removeEventListener('pointercancel', cleanup)
        onResizeEnd()
      }

      target.addEventListener('pointermove', handlePointerMove)
      target.addEventListener('pointerup', cleanup)
      target.addEventListener('pointercancel', cleanup)
    },
    [column.name, onResizeStart, onResize, onResizeEnd]
  )

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (readOnly || isRenaming) {
        e.preventDefault()
        return
      }
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', column.name)
      onDragStart?.(column.name)
    },
    [column.name, readOnly, isRenaming, onDragStart]
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const midX = rect.left + rect.width / 2
      const side = e.clientX < midX ? 'left' : 'right'
      onDragOver?.(column.name, side)
    },
    [column.name, onDragOver]
  )

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDragEnd = useCallback(() => {
    onDragEnd?.()
  }, [onDragEnd])

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      const th = e.currentTarget as HTMLElement
      const related = e.relatedTarget as Node | null
      if (related && th.contains(related)) return
      onDragLeave?.()
    },
    [onDragLeave]
  )

  return (
    <th
      className={cn(
        'group relative border-[var(--border)] border-r border-b bg-[var(--bg)] p-0 text-left align-middle',
        isDragging && 'opacity-40'
      )}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
    >
      {isRenaming ? (
        <div className='flex h-full w-full min-w-0 items-center px-2 py-[7px]'>
          <ColumnTypeIcon type={column.type} />
          <input
            ref={renameInputRef}
            type='text'
            value={renameValue}
            onChange={(e) => onRenameValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit()
              if (e.key === 'Escape') onRenameCancel()
            }}
            onBlur={onRenameSubmit}
            className='ml-1.5 min-w-0 flex-1 border-0 bg-transparent p-0 font-medium text-[var(--text-primary)] text-small outline-none focus:outline-none focus:ring-0'
          />
        </div>
      ) : readOnly ? (
        <div className='flex h-full w-full min-w-0 items-center px-2 py-[7px]'>
          <ColumnTypeIcon type={column.type} />
          <span className='ml-1.5 min-w-0 overflow-clip text-ellipsis whitespace-nowrap font-medium text-[13px] text-[var(--text-primary)]'>
            {column.name}
          </span>
        </div>
      ) : (
        <div className='flex h-full w-full min-w-0 items-center'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                className='flex min-w-0 flex-1 cursor-pointer items-center px-2 py-[7px] outline-none'
              >
                <ColumnTypeIcon type={column.type} />
                <span className='ml-1.5 min-w-0 overflow-clip text-ellipsis whitespace-nowrap font-medium text-[var(--text-primary)] text-small'>
                  {column.name}
                </span>
                <ChevronDown className='ml-1.5 h-[7px] w-[9px] shrink-0 text-[var(--text-muted)]' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start'>
              <DropdownMenuItem onSelect={() => onRenameColumn(column.name)}>
                <Pencil />
                Rename column
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {React.createElement(COLUMN_TYPE_ICONS[column.type] ?? TypeText)}
                  Change type
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {COLUMN_TYPE_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.type}
                      disabled={column.type === option.type}
                      onSelect={() => onChangeType(column.name, option.type)}
                    >
                      <option.icon />
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onInsertLeft(column.name)}>
                <ArrowLeft />
                Insert column left
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onInsertRight(column.name)}>
                <ArrowRight />
                Insert column right
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onToggleUnique(column.name)}>
                <Fingerprint />
                {column.unique ? 'Remove unique' : 'Set unique'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onDeleteColumn(column.name)}>
                <Trash />
                Delete column
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            className='flex h-full cursor-grab items-center pr-1.5 pl-0.5 opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100'
          >
            <GripVertical className='h-3 w-3 shrink-0 text-[var(--text-muted)]' />
          </div>
        </div>
      )}
      <div
        className='-right-[3px] absolute top-0 z-[1] h-full w-[6px] cursor-col-resize'
        draggable={false}
        onDragStart={(e) => e.stopPropagation()}
        onPointerDown={handleResizePointerDown}
      />
    </th>
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
        className='flex h-[20px] cursor-pointer items-center gap-2'
        onClick={onClick}
        disabled={disabled}
      >
        <Plus className='h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
        <span className='font-medium text-[var(--text-body)] text-small'>New column</span>
      </button>
    </th>
  )
})

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

function ColumnTypeIcon({ type }: { type: string }) {
  const Icon = COLUMN_TYPE_ICONS[type] ?? TypeText
  return <Icon className='h-3 w-3 shrink-0 text-[var(--text-icon)]' />
}
