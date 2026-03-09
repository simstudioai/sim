'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Button,
  Checkbox,
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
  Asterisk,
  Calendar as CalendarIcon,
  ChevronDown,
  Key,
  Pencil,
  Plus,
  Table as TableIcon,
  Trash,
  TypeBoolean,
  TypeJson,
  TypeNumber,
  TypeText,
} from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import type { ColumnDefinition, Filter, SortDirection, TableRow as TableRowType } from '@/lib/table'
import { ResourceHeader, ResourceOptionsBar } from '@/app/workspace/[workspaceId]/components'
import type {
  ColumnOption,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-options-bar'
import {
  useAddTableColumn,
  useCreateTableRow,
  useDeleteColumn,
  useDeleteTable,
  useRenameTable,
  useUpdateColumn,
  useUpdateTableRow,
} from '@/hooks/queries/tables'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { useContextMenu, useRowSelection, useTableData } from '../../hooks'
import type { EditingCell, QueryOptions, SaveReason } from '../../types'
import { cleanCellValue, formatValueForInput } from '../../utils'
import { ContextMenu } from '../context-menu'
import { RowModal } from '../row-modal'
import { SchemaModal } from '../schema-modal'
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

interface PendingPlaceholder {
  rowId: string | null
  data: Record<string, unknown>
}

const EMPTY_COLUMNS: never[] = []
const PLACEHOLDER_ROW_COUNT = 1000
const COL_WIDTH = 160
const COL_WIDTH_MIN = 80
const CHECKBOX_COL_WIDTH = 40
const ADD_COL_WIDTH = 120
const SKELETON_COL_COUNT = 4
const SKELETON_ROW_COUNT = 10
const ROW_HEIGHT_ESTIMATE = 35
const PLACEHOLDER_OVERSCAN = 20

const CELL = 'border-[var(--border)] border-r border-b px-[8px] py-[7px] align-middle select-none'
const CELL_CHECKBOX =
  'border-[var(--border)] border-r border-b px-[4px] py-[7px] align-middle select-none'
const CELL_HEADER =
  'border-[var(--border)] border-r border-b bg-white px-[8px] py-[7px] text-left align-middle dark:bg-[var(--bg)]'
const CELL_HEADER_CHECKBOX =
  'border-[var(--border)] border-r border-b bg-white px-[4px] py-[7px] text-center align-middle dark:bg-[var(--bg)]'
const CELL_CONTENT =
  'relative min-h-[20px] min-w-0 overflow-clip text-ellipsis whitespace-nowrap text-[13px]'
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

  const [queryOptions, setQueryOptions] = useState<QueryOptions>({
    filter: null,
    sort: null,
  })
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingRow, setEditingRow] = useState<TableRowType | null>(null)
  const [deletingRows, setDeletingRows] = useState<string[]>([])
  const [showSchemaModal, setShowSchemaModal] = useState(false)
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [initialCharacter, setInitialCharacter] = useState<string | null>(null)
  const [selectionAnchor, setSelectionAnchor] = useState<CellCoord | null>(null)
  const [selectionFocus, setSelectionFocus] = useState<CellCoord | null>(null)
  const [pendingPlaceholders, setPendingPlaceholders] = useState<
    Record<number, PendingPlaceholder>
  >({})

  const [editingEmptyCell, setEditingEmptyCell] = useState<{
    rowIndex: number
    columnName: string
  } | null>(null)
  const [showDeleteTableConfirm, setShowDeleteTableConfirm] = useState(false)
  const [deletingColumn, setDeletingColumn] = useState<string | null>(null)

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)

  const isDraggingRef = useRef(false)

  const { tableData, isLoadingTable, rows, isLoadingRows } = useTableData({
    workspaceId,
    tableId,
    queryOptions,
  })

  const { selectedRows, handleSelectAll, handleSelectRow, clearSelection } = useRowSelection(rows)

  const {
    contextMenu,
    handleRowContextMenu: baseHandleRowContextMenu,
    closeContextMenu,
  } = useContextMenu()

  const updateRowMutation = useUpdateTableRow({ workspaceId, tableId })
  const createRowMutation = useCreateTableRow({ workspaceId, tableId })
  const addColumnMutation = useAddTableColumn({ workspaceId, tableId })
  const updateColumnMutation = useUpdateColumn({ workspaceId, tableId })
  const deleteColumnMutation = useDeleteColumn({ workspaceId, tableId })

  const columns = useMemo(
    () => tableData?.schema?.columns || EMPTY_COLUMNS,
    [tableData?.schema?.columns]
  )

  const pendingRowIds = useMemo(() => {
    const ids = new Set<string>()
    for (const pending of Object.values(pendingPlaceholders)) {
      if (pending.rowId) ids.add(pending.rowId)
    }
    return ids
  }, [pendingPlaceholders])

  const visibleRows = useMemo(
    () => rows.filter((r) => !pendingRowIds.has(r.id)),
    [rows, pendingRowIds]
  )

  const normalizedSelection = useMemo(
    () => computeNormalizedSelection(selectionAnchor, selectionFocus),
    [selectionAnchor, selectionFocus]
  )

  const displayColCount = isLoadingTable ? SKELETON_COL_COUNT : columns.length
  const tableWidth = useMemo(() => {
    const colsWidth = isLoadingTable
      ? displayColCount * COL_WIDTH
      : columns.reduce((sum, col) => sum + (columnWidths[col.name] ?? COL_WIDTH), 0)
    return CHECKBOX_COL_WIDTH + colsWidth + ADD_COL_WIDTH
  }, [isLoadingTable, displayColCount, columns, columnWidths])

  const resizeIndicatorLeft = useMemo(() => {
    if (!resizingColumn) return 0
    let left = CHECKBOX_COL_WIDTH
    for (const col of columns) {
      left += columnWidths[col.name] ?? COL_WIDTH
      if (col.name === resizingColumn) return left
    }
    return 0
  }, [resizingColumn, columns, columnWidths])

  const isAllRowsSelected =
    normalizedSelection !== null &&
    visibleRows.length > 0 &&
    normalizedSelection.startRow === 0 &&
    normalizedSelection.endRow === visibleRows.length - 1 &&
    normalizedSelection.startCol === 0 &&
    normalizedSelection.endCol === columns.length - 1

  const columnsRef = useRef(columns)
  const rowsRef = useRef(rows)
  const visibleRowsRef = useRef(visibleRows)
  const pendingPlaceholdersRef = useRef(pendingPlaceholders)
  const selectionAnchorRef = useRef(selectionAnchor)
  const selectionFocusRef = useRef(selectionFocus)

  columnsRef.current = columns
  rowsRef.current = rows
  visibleRowsRef.current = visibleRows
  pendingPlaceholdersRef.current = pendingPlaceholders
  selectionAnchorRef.current = selectionAnchor
  selectionFocusRef.current = selectionFocus

  const deleteTableMutation = useDeleteTable(workspaceId)
  const renameTableMutation = useRenameTable(workspaceId)

  const tableHeaderRename = useInlineRename({
    onSave: (_id, name) => renameTableMutation.mutate({ tableId, name }),
  })

  const columnRename = useInlineRename({
    onSave: (columnName, newName) => {
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

  const handleAddRow = useCallback(() => {
    setShowAddModal(true)
  }, [])

  const handleDeleteSelected = useCallback(() => {
    setDeletingRows(Array.from(selectedRows))
  }, [selectedRows])

  const handleContextMenuEdit = useCallback(() => {
    if (contextMenu.row) {
      setEditingRow(contextMenu.row)
    }
    closeContextMenu()
  }, [contextMenu.row, closeContextMenu])

  const handleContextMenuDelete = useCallback(() => {
    if (contextMenu.row) {
      setDeletingRows([contextMenu.row.id])
    }
    closeContextMenu()
  }, [contextMenu.row, closeContextMenu])

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, row: TableRowType) => {
      setEditingCell(null)
      baseHandleRowContextMenu(e, row)
    },
    [baseHandleRowContextMenu]
  )

  const handleCellMouseDown = useCallback(
    (rowIndex: number, colIndex: number, shiftKey: boolean) => {
      if (shiftKey && selectionAnchorRef.current) {
        setSelectionFocus({ rowIndex, colIndex })
      } else {
        setSelectionAnchor({ rowIndex, colIndex })
        setSelectionFocus(null)
      }
      isDraggingRef.current = true
    },
    []
  )

  const handleCellMouseEnter = useCallback((rowIndex: number, colIndex: number) => {
    if (!isDraggingRef.current) return
    setSelectionFocus({ rowIndex, colIndex })
  }, [])

  const handleRowMouseDown = useCallback((rowIndex: number, shiftKey: boolean) => {
    const lastCol = columnsRef.current.length - 1
    if (lastCol < 0) return

    setEditingCell(null)
    setEditingEmptyCell(null)

    if (shiftKey && selectionAnchorRef.current) {
      setSelectionAnchor((prev) => (prev ? { rowIndex: prev.rowIndex, colIndex: 0 } : prev))
      setSelectionFocus({ rowIndex, colIndex: lastCol })
    } else {
      setSelectionAnchor({ rowIndex, colIndex: 0 })
      setSelectionFocus({ rowIndex, colIndex: lastCol })
    }
    isDraggingRef.current = true
  }, [])

  const handleRowMouseEnter = useCallback((rowIndex: number) => {
    if (!isDraggingRef.current) return
    const lastCol = columnsRef.current.length - 1
    if (lastCol < 0) return
    setSelectionFocus({ rowIndex, colIndex: lastCol })
  }, [])

  const handleRowSelect = useCallback((rowIndex: number) => {
    const lastCol = columnsRef.current.length - 1
    if (lastCol < 0) return
    setEditingCell(null)
    setEditingEmptyCell(null)
    setSelectionAnchor({ rowIndex, colIndex: 0 })
    setSelectionFocus({ rowIndex, colIndex: lastCol })
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectionAnchor(null)
    setSelectionFocus(null)
  }, [])

  const handleSelectAllRows = useCallback(() => {
    const lastRow = visibleRowsRef.current.length - 1
    const lastCol = columnsRef.current.length - 1
    if (lastRow < 0 || lastCol < 0) return
    setEditingCell(null)
    setEditingEmptyCell(null)
    setSelectionAnchor({ rowIndex: 0, colIndex: 0 })
    setSelectionFocus({ rowIndex: lastRow, colIndex: lastCol })
  }, [])

  const handleColumnResizeStart = useCallback((columnName: string) => {
    setResizingColumn(columnName)
  }, [])

  const handleColumnResize = useCallback((columnName: string, width: number) => {
    setColumnWidths((prev) => ({ ...prev, [columnName]: Math.max(COL_WIDTH_MIN, width) }))
  }, [])

  const handleColumnResizeEnd = useCallback(() => {
    setResizingColumn(null)
  }, [])

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
    const current = editingCellRef.current
    if (current && current.rowId === rowId && current.columnName === columnName) return
    setEditingCell(null)
    setEditingEmptyCell(null)
    setInitialCharacter(null)
  }, [])

  const handleCellDoubleClick = useCallback((rowId: string, columnName: string) => {
    const column = columnsRef.current.find((c) => c.name === columnName)
    if (!column) return

    setSelectionFocus(null)

    if (column.type === 'json') {
      const row = rowsRef.current.find((r) => r.id === rowId)
      if (row) setEditingRow(row)
      return
    }

    if (column.type === 'boolean') {
      const row = rowsRef.current.find((r) => r.id === rowId)
      if (row) {
        mutateRef.current({ rowId, data: { [columnName]: !row.data[columnName] } })
      }
      return
    }

    setEditingCell({ rowId, columnName })
    setInitialCharacter(null)
  }, [])

  const mutateRef = useRef(updateRowMutation.mutate)
  mutateRef.current = updateRowMutation.mutate

  const editingCellRef = useRef(editingCell)
  editingCellRef.current = editingCell

  const editingEmptyCellRef = useRef(editingEmptyCell)
  editingEmptyCellRef.current = editingEmptyCell

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const anchor = selectionAnchorRef.current
      if (!anchor || editingCellRef.current || editingEmptyCellRef.current) return

      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      const cols = columnsRef.current
      const dataRows = visibleRowsRef.current
      const totalRows = dataRows.length + PLACEHOLDER_ROW_COUNT

      if (e.key === 'Escape') {
        e.preventDefault()
        setSelectionAnchor(null)
        setSelectionFocus(null)
        return
      }

      if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault()
        const row = anchor.rowIndex < dataRows.length ? dataRows[anchor.rowIndex] : null
        const col = cols[anchor.colIndex]
        if (!col) return

        if (anchor.rowIndex >= dataRows.length) {
          const placeholderIndex = anchor.rowIndex - dataRows.length
          if (col.type !== 'json' && col.type !== 'boolean') {
            setEditingEmptyCell({ rowIndex: placeholderIndex, columnName: col.name })
          }
          return
        }

        if (col.type === 'json') {
          if (row) setEditingRow(row)
          return
        }
        if (col.type === 'boolean') {
          if (row) mutateRef.current({ rowId: row.id, data: { [col.name]: !row.data[col.name] } })
          return
        }
        if (row) {
          setEditingCell({ rowId: row.id, columnName: col.name })
          setInitialCharacter(null)
        }
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        setSelectionAnchor(moveCell(anchor, cols.length, totalRows, e.shiftKey ? -1 : 1))
        setSelectionFocus(null)
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault()
        if (dataRows.length > 0 && cols.length > 0) {
          setSelectionAnchor({ rowIndex: 0, colIndex: 0 })
          setSelectionFocus({ rowIndex: dataRows.length - 1, colIndex: cols.length - 1 })
        }
        return
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        const focus = selectionFocusRef.current ?? anchor
        const target = e.shiftKey ? focus : anchor
        let newRow = target.rowIndex
        let newCol = target.colIndex

        switch (e.key) {
          case 'ArrowUp':
            newRow = Math.max(0, newRow - 1)
            break
          case 'ArrowDown':
            newRow = Math.min(totalRows - 1, newRow + 1)
            break
          case 'ArrowLeft':
            newCol = Math.max(0, newCol - 1)
            break
          case 'ArrowRight':
            newCol = Math.min(cols.length - 1, newCol + 1)
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
        e.preventDefault()
        const sel = computeNormalizedSelection(anchor, selectionFocusRef.current)
        if (!sel) return

        for (let r = sel.startRow; r <= sel.endRow; r++) {
          if (r >= dataRows.length) continue
          const row = dataRows[r]
          const updates: Record<string, unknown> = {}
          for (let c = sel.startCol; c <= sel.endCol; c++) {
            if (c < cols.length) updates[cols[c].name] = null
          }
          mutateRef.current({ rowId: row.id, data: updates })
        }
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault()
        const sel = computeNormalizedSelection(anchor, selectionFocusRef.current)
        if (!sel) return

        const lines: string[] = []
        for (let r = sel.startRow; r <= sel.endRow; r++) {
          const cells: string[] = []
          for (let c = sel.startCol; c <= sel.endCol; c++) {
            let value: unknown = null
            if (r < dataRows.length) {
              value = dataRows[r].data[cols[c].name]
            } else {
              const pi = r - dataRows.length
              value = pendingPlaceholdersRef.current[pi]?.data[cols[c].name] ?? null
            }
            if (value === null || value === undefined) {
              cells.push('')
            } else {
              cells.push(typeof value === 'object' ? JSON.stringify(value) : String(value))
            }
          }
          lines.push(cells.join('\t'))
        }
        navigator.clipboard.writeText(lines.join('\n'))
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        e.preventDefault()
        navigator.clipboard.readText().then((text) => {
          const currentAnchor = selectionAnchorRef.current
          if (!currentAnchor) return

          const pasteRows = text
            .split(/\r?\n/)
            .filter((line, idx, arr) => !(idx === arr.length - 1 && line === ''))
            .map((line) => line.split('\t'))

          const currentCols = columnsRef.current
          const currentDataRows = visibleRowsRef.current

          for (let r = 0; r < pasteRows.length; r++) {
            const targetRow = currentAnchor.rowIndex + r
            if (targetRow >= currentDataRows.length + PLACEHOLDER_ROW_COUNT) break

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

            if (targetRow < currentDataRows.length) {
              mutateRef.current({ rowId: currentDataRows[targetRow].id, data: rowData })
            } else {
              createRef.current(rowData)
            }
          }

          const maxPasteCols = Math.max(...pasteRows.map((pr) => pr.length))
          setSelectionFocus({
            rowIndex: Math.min(
              currentAnchor.rowIndex + pasteRows.length - 1,
              currentDataRows.length + PLACEHOLDER_ROW_COUNT - 1
            ),
            colIndex: Math.min(currentAnchor.colIndex + maxPasteCols - 1, currentCols.length - 1),
          })
        })
        return
      }

      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const col = cols[anchor.colIndex]
        if (!col || col.type === 'json' || col.type === 'boolean') return
        e.preventDefault()

        if (anchor.rowIndex < dataRows.length) {
          const row = dataRows[anchor.rowIndex]
          setEditingCell({ rowId: row.id, columnName: col.name })
          setInitialCharacter(e.key)
        } else {
          const placeholderIndex = anchor.rowIndex - dataRows.length
          setEditingEmptyCell({ rowIndex: placeholderIndex, columnName: col.name })
          setInitialCharacter(e.key)
        }
        return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const navigateAfterSave = useCallback((reason: SaveReason) => {
    const anchor = selectionAnchorRef.current
    if (!anchor) return
    const cols = columnsRef.current
    const totalRows = visibleRowsRef.current.length + PLACEHOLDER_ROW_COUNT

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
  }, [])

  const handleInlineSave = useCallback(
    (rowId: string, columnName: string, value: unknown, reason: SaveReason) => {
      setEditingCell(null)
      setInitialCharacter(null)

      const row = rowsRef.current.find((r) => r.id === rowId)
      if (!row) return

      const oldValue = row.data[columnName]
      if (!(oldValue === value) && !(oldValue === null && value === null)) {
        mutateRef.current({ rowId, data: { [columnName]: value } })
      }

      navigateAfterSave(reason)
    },
    [navigateAfterSave]
  )

  const handleInlineCancel = useCallback(() => {
    setEditingCell(null)
    setInitialCharacter(null)
  }, [])

  const handleEmptyRowClick = useCallback((rowIndex: number, columnName: string) => {
    const current = editingEmptyCellRef.current
    if (current && current.rowIndex === rowIndex && current.columnName === columnName) return
    setEditingEmptyCell(null)
    setInitialCharacter(null)
  }, [])

  const handleEmptyRowDoubleClick = useCallback((rowIndex: number, columnName: string) => {
    const column = columnsRef.current.find((c) => c.name === columnName)
    if (!column || column.type === 'json' || column.type === 'boolean') return
    setSelectionFocus(null)
    setEditingEmptyCell({ rowIndex, columnName })
    setInitialCharacter(null)
  }, [])

  const createRef = useRef(createRowMutation.mutate)
  createRef.current = createRowMutation.mutate

  const handleEmptyRowSave = useCallback(
    (rowIndex: number, columnName: string, value: unknown, reason: SaveReason) => {
      setEditingEmptyCell(null)
      setInitialCharacter(null)

      if (value !== null && value !== undefined && value !== '') {
        const existing = pendingPlaceholdersRef.current[rowIndex]
        const updatedData = { ...(existing?.data || {}), [columnName]: value }

        if (existing?.rowId) {
          setPendingPlaceholders((prev) => ({
            ...prev,
            [rowIndex]: { ...prev[rowIndex], data: updatedData },
          }))
          mutateRef.current({ rowId: existing.rowId, data: { [columnName]: value } })
        } else {
          setPendingPlaceholders((prev) => ({
            ...prev,
            [rowIndex]: { rowId: null, data: updatedData },
          }))
          createRef.current(updatedData, {
            onSuccess: (response: Record<string, unknown>) => {
              const data = response?.data as Record<string, unknown> | undefined
              const row = data?.row as Record<string, unknown> | undefined
              const newRowId = row?.id as string | undefined
              if (newRowId) {
                setPendingPlaceholders((prev) => {
                  if (!prev[rowIndex]) return prev
                  return {
                    ...prev,
                    [rowIndex]: { ...prev[rowIndex], rowId: newRowId },
                  }
                })
              }
            },
            onError: () => {
              setPendingPlaceholders((prev) => {
                const next = { ...prev }
                delete next[rowIndex]
                return next
              })
            },
          })
        }
      }

      navigateAfterSave(reason)
    },
    [navigateAfterSave]
  )

  const handleEmptyRowCancel = useCallback(() => {
    setEditingEmptyCell(null)
    setInitialCharacter(null)
  }, [])

  const generateColumnName = useCallback(() => {
    const existing = columnsRef.current.map((c) => c.name.toLowerCase())
    let name = 'untitled'
    let i = 2
    while (existing.includes(name.toLowerCase())) {
      name = `untitled_${i}`
      i++
    }
    return name
  }, [])

  const handleAddColumn = useCallback(() => {
    addColumnMutation.mutate({ name: generateColumnName(), type: 'string' })
  }, [generateColumnName])

  const handleChangeType = useCallback((columnName: string, newType: string) => {
    updateColumnMutation.mutate({ columnName, updates: { type: newType } })
  }, [])

  const handleInsertColumnLeft = useCallback(
    (columnName: string) => {
      const index = columnsRef.current.findIndex((c) => c.name === columnName)
      if (index === -1) return
      addColumnMutation.mutate({ name: generateColumnName(), type: 'string', position: index })
    },
    [generateColumnName]
  )

  const handleInsertColumnRight = useCallback(
    (columnName: string) => {
      const index = columnsRef.current.findIndex((c) => c.name === columnName)
      if (index === -1) return
      addColumnMutation.mutate({ name: generateColumnName(), type: 'string', position: index + 1 })
    },
    [generateColumnName]
  )

  const handleToggleUnique = useCallback((columnName: string) => {
    const column = columnsRef.current.find((c) => c.name === columnName)
    if (!column) return
    updateColumnMutation.mutate({ columnName, updates: { unique: !column.unique } })
  }, [])

  const handleToggleRequired = useCallback((columnName: string) => {
    const column = columnsRef.current.find((c) => c.name === columnName)
    if (!column) return
    updateColumnMutation.mutate({ columnName, updates: { required: !column.required } })
  }, [])

  const handleDeleteColumn = useCallback((columnName: string) => {
    setDeletingColumn(columnName)
  }, [])

  const handleDeleteColumnConfirm = useCallback(() => {
    if (!deletingColumn) return
    deleteColumnMutation.mutate(deletingColumn)
    setDeletingColumn(null)
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
  const columnOptions = useMemo<ColumnOption[]>(
    () =>
      columns.map((col) => ({
        id: col.name,
        label: col.name,
        type: col.type,
        icon: COLUMN_TYPE_ICONS[col.type],
      })),
    [columns]
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

  if (!isLoadingTable && !tableData) {
    return (
      <div className='flex h-full items-center justify-center'>
        <span className='text-[13px] text-[var(--text-error)]'>Table not found</span>
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col'>
      {!embedded && (
        <>
          <ResourceHeader
            icon={TableIcon}
            breadcrumbs={[
              { label: 'Tables', onClick: handleNavigateBack },
              ...(tableData
                ? [
                    {
                      label: tableData.name,
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
                          onClick: () => {
                            if (tableData) tableHeaderRename.startRename(tableId, tableData.name)
                          },
                        },
                        {
                          label: 'Delete',
                          icon: Trash,
                          onClick: () => setShowDeleteTableConfirm(true),
                        },
                      ],
                    },
                  ]
                : []),
            ]}
            create={{
              label: 'New column',
              onClick: handleAddColumn,
              disabled: addColumnMutation.isPending,
            }}
          />

          <ResourceOptionsBar
            sort={sortConfig}
            filter={<TableFilter columns={columns} onApply={handleFilterApply} />}
          />
        </>
      )}

      <div
        className={cn(
          'min-h-0 flex-1 overflow-auto overscroll-none',
          resizingColumn && 'select-none'
        )}
        data-table-scroll
      >
        <div className='relative' style={{ width: `${tableWidth}px` }}>
          <table
            className='table-fixed border-separate border-spacing-0 text-[13px]'
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
              <TableColGroup columns={columns} columnWidths={columnWidths} />
            )}
            <thead className='sticky top-0 z-10'>
              {isLoadingTable ? (
                <tr>
                  <th className={CELL_HEADER_CHECKBOX}>
                    <div className='flex items-center justify-center'>
                      <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />
                    </div>
                  </th>
                  {Array.from({ length: SKELETON_COL_COUNT }).map((_, i) => (
                    <th key={i} className={CELL_HEADER}>
                      <div className='flex h-[20px] min-w-0 items-center gap-[6px]'>
                        <Skeleton className='h-[14px] w-[14px] shrink-0 rounded-[2px]' />
                        <Skeleton className='h-[14px]' style={{ width: `${56 + i * 16}px` }} />
                      </div>
                    </th>
                  ))}
                  <th className={CELL_HEADER}>
                    <div className='flex h-[20px] items-center gap-[8px]'>
                      <Skeleton className='h-[14px] w-[14px] shrink-0 rounded-[2px]' />
                      <Skeleton className='h-[14px] w-[72px]' />
                    </div>
                  </th>
                </tr>
              ) : (
                <tr>
                  <th className={CELL_HEADER_CHECKBOX}>
                    <div className='flex items-center justify-center'>
                      <Checkbox
                        size='sm'
                        checked={isAllRowsSelected}
                        onCheckedChange={() => {
                          if (isAllRowsSelected) {
                            handleClearSelection()
                          } else {
                            handleSelectAllRows()
                          }
                        }}
                      />
                    </div>
                  </th>
                  {columns.map((column) => (
                    <ColumnHeaderMenu
                      key={column.name}
                      column={column}
                      isRenaming={columnRename.editingId === column.name}
                      renameValue={columnRename.editValue}
                      onRenameValueChange={columnRename.setEditValue}
                      onRenameSubmit={columnRename.submitRename}
                      onRenameCancel={columnRename.cancelRename}
                      onRenameColumn={(name: string) => columnRename.startRename(name, name)}
                      onChangeType={handleChangeType}
                      onInsertLeft={handleInsertColumnLeft}
                      onInsertRight={handleInsertColumnRight}
                      onToggleUnique={handleToggleUnique}
                      onToggleRequired={handleToggleRequired}
                      onDeleteColumn={handleDeleteColumn}
                      onResizeStart={handleColumnResizeStart}
                      onResize={handleColumnResize}
                      onResizeEnd={handleColumnResizeEnd}
                    />
                  ))}
                  <th className={CELL_HEADER}>
                    <button
                      type='button'
                      className='flex h-[20px] cursor-pointer items-center gap-[8px]'
                      onClick={handleAddColumn}
                      disabled={addColumnMutation.isPending}
                    >
                      <Plus className='h-[14px] w-[14px] shrink-0 text-[var(--text-muted)]' />
                      <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                        New column
                      </span>
                    </button>
                  </th>
                </tr>
              )}
            </thead>
            <tbody>
              {isLoadingTable || isLoadingRows ? (
                <TableBodySkeleton colCount={displayColCount} />
              ) : (
                <>
                  {visibleRows.map((row, index) => (
                    <DataRow
                      key={row.id}
                      row={row}
                      columns={columns}
                      rowIndex={index}
                      isFirstRow={index === 0}
                      editingColumnName={
                        editingCell?.rowId === row.id ? editingCell.columnName : null
                      }
                      initialCharacter={editingCell?.rowId === row.id ? initialCharacter : null}
                      normalizedSelection={normalizedSelection}
                      onClick={handleCellClick}
                      onDoubleClick={handleCellDoubleClick}
                      onSave={handleInlineSave}
                      onCancel={handleInlineCancel}
                      onContextMenu={handleRowContextMenu}
                      onCellMouseDown={handleCellMouseDown}
                      onCellMouseEnter={handleCellMouseEnter}
                      onRowMouseDown={handleRowMouseDown}
                      onRowMouseEnter={handleRowMouseEnter}
                      onRowSelect={handleRowSelect}
                      onClearSelection={handleClearSelection}
                    />
                  ))}
                  <PlaceholderRows
                    columns={columns}
                    dataRowCount={visibleRows.length}
                    editingEmptyCell={editingEmptyCell}
                    initialCharacter={editingEmptyCell ? initialCharacter : null}
                    pendingPlaceholders={pendingPlaceholders}
                    normalizedSelection={normalizedSelection}
                    firstRowUnderHeader={visibleRows.length === 0}
                    onClick={handleEmptyRowClick}
                    onDoubleClick={handleEmptyRowDoubleClick}
                    onSave={handleEmptyRowSave}
                    onCancel={handleEmptyRowCancel}
                    onCellMouseDown={handleCellMouseDown}
                    onCellMouseEnter={handleCellMouseEnter}
                    onRowMouseDown={handleRowMouseDown}
                    onRowMouseEnter={handleRowMouseEnter}
                  />
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
        </div>
      </div>

      {showAddModal && tableData && (
        <RowModal
          mode='add'
          isOpen={true}
          onClose={() => setShowAddModal(false)}
          table={tableData}
          onSuccess={() => setShowAddModal(false)}
        />
      )}

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
          rowIds={deletingRows}
          onSuccess={() => {
            setDeletingRows([])
            clearSelection()
          }}
        />
      )}

      {tableData && (
        <SchemaModal
          isOpen={showSchemaModal}
          onClose={() => setShowSchemaModal(false)}
          columns={columns}
          tableName={tableData.name}
        />
      )}

      <ContextMenu
        contextMenu={contextMenu}
        onClose={closeContextMenu}
        onEdit={handleContextMenuEdit}
        onDelete={handleContextMenuDelete}
      />

      {!embedded && (
        <Modal open={showDeleteTableConfirm} onOpenChange={setShowDeleteTableConfirm}>
          <ModalContent size='sm'>
            <ModalHeader>Delete Table</ModalHeader>
            <ModalBody>
              <p className='text-[13px] text-[var(--text-secondary)]'>
                Are you sure you want to delete{' '}
                <span className='font-medium text-[var(--text-primary)]'>{tableData?.name}</span>?{' '}
                <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
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
            <p className='text-[13px] text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>{deletingColumn}</span>? This
              will remove all data in this column.{' '}
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
  normalizedSelection: NormalizedSelection | null
  onClick: (rowId: string, columnName: string) => void
  onDoubleClick: (rowId: string, columnName: string) => void
  onSave: (rowId: string, columnName: string, value: unknown, reason: SaveReason) => void
  onCancel: () => void
  onContextMenu: (e: React.MouseEvent, row: TableRowType) => void
  onCellMouseDown: (rowIndex: number, colIndex: number, shiftKey: boolean) => void
  onCellMouseEnter: (rowIndex: number, colIndex: number) => void
  onRowMouseDown: (rowIndex: number, shiftKey: boolean) => void
  onRowMouseEnter: (rowIndex: number) => void
  onRowSelect: (rowIndex: number) => void
  onClearSelection: () => void
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
    prev.onClick !== next.onClick ||
    prev.onDoubleClick !== next.onDoubleClick ||
    prev.onSave !== next.onSave ||
    prev.onCancel !== next.onCancel ||
    prev.onContextMenu !== next.onContextMenu ||
    prev.onCellMouseDown !== next.onCellMouseDown ||
    prev.onCellMouseEnter !== next.onCellMouseEnter ||
    prev.onRowMouseDown !== next.onRowMouseDown ||
    prev.onRowMouseEnter !== next.onRowMouseEnter ||
    prev.onRowSelect !== next.onRowSelect ||
    prev.onClearSelection !== next.onClearSelection
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
  normalizedSelection,
  onClick,
  onDoubleClick,
  onSave,
  onCancel,
  onContextMenu,
  onCellMouseDown,
  onCellMouseEnter,
  onRowMouseDown,
  onRowMouseEnter,
  onRowSelect,
  onClearSelection,
}: DataRowProps) {
  const sel = normalizedSelection
  const isMultiCell = sel !== null && (sel.startRow !== sel.endRow || sel.startCol !== sel.endCol)
  const isRowSelected =
    sel !== null &&
    rowIndex >= sel.startRow &&
    rowIndex <= sel.endRow &&
    sel.startCol === 0 &&
    sel.endCol === columns.length - 1

  return (
    <tr onContextMenu={(e) => onContextMenu(e, row)}>
      <td
        className={cn(CELL_CHECKBOX, 'group/checkbox cursor-pointer text-center')}
        onMouseDown={(e) => {
          if (e.button !== 0 || isRowSelected) return
          onRowMouseDown(rowIndex, e.shiftKey)
        }}
        onMouseEnter={() => onRowMouseEnter(rowIndex)}
      >
        <span
          className={cn(
            'text-[11px] text-[var(--text-tertiary)] tabular-nums',
            isRowSelected ? 'hidden' : 'block group-hover/checkbox:hidden'
          )}
        >
          {rowIndex + 1}
        </span>
        <div
          className={cn(
            'items-center justify-center',
            isRowSelected ? 'flex' : 'hidden group-hover/checkbox:flex'
          )}
          onMouseDown={(e) => {
            e.stopPropagation()
            if (e.button !== 0) return
            if (e.shiftKey) {
              onRowMouseDown(rowIndex, true)
            } else if (isRowSelected) {
              onClearSelection()
            } else {
              onRowSelect(rowIndex)
            }
          }}
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

        const isTopEdge = inRange && rowIndex === sel!.startRow
        const isBottomEdge = inRange && rowIndex === sel!.endRow
        const isLeftEdge = inRange && colIndex === sel!.startCol
        const isRightEdge = inRange && colIndex === sel!.endCol

        return (
          <td
            key={column.name}
            data-row={rowIndex}
            data-col={colIndex}
            className={cn(CELL, (inRange || isAnchor) && 'relative')}
            onMouseDown={(e) => {
              if (e.button !== 0 || isEditing) return
              onCellMouseDown(rowIndex, colIndex, e.shiftKey)
            }}
            onMouseEnter={() => onCellMouseEnter(rowIndex, colIndex)}
            onClick={() => onClick(row.id, column.name)}
            onDoubleClick={() => onDoubleClick(row.id, column.name)}
          >
            {inRange && isMultiCell && (
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
                value={row.data[column.name]}
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
  if (isEditing) {
    return (
      <InlineEditor
        value={value}
        column={column}
        initialCharacter={initialCharacter ?? undefined}
        onSave={onSave}
        onCancel={onCancel}
      />
    )
  }

  const isNull = value === null || value === undefined

  if (column.type === 'boolean') {
    const boolValue = Boolean(value)
    return (
      <span className={boolValue ? 'text-green-500' : 'text-[var(--text-tertiary)]'}>
        {isNull ? '' : boolValue ? 'true' : 'false'}
      </span>
    )
  }

  if (isNull) return null

  if (column.type === 'json') {
    return (
      <span className='block truncate font-mono text-[11px] text-[var(--text-secondary)]'>
        {JSON.stringify(value)}
      </span>
    )
  }

  if (column.type === 'number') {
    return (
      <span className='font-mono text-[12px] text-[var(--text-secondary)]'>{String(value)}</span>
    )
  }

  if (column.type === 'date') {
    try {
      const date = new Date(String(value))
      const formatted = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      return <span className='text-[12px] text-[var(--text-secondary)]'>{formatted}</span>
    } catch {
      return <span className='text-[var(--text-primary)]'>{String(value)}</span>
    }
  }

  return <span className='text-[var(--text-primary)]'>{String(value)}</span>
}

function InlineEditor({
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

  const inputType = column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'

  return (
    <input
      ref={inputRef}
      type={inputType}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => doSave('blur')}
      className={cn(
        'w-full min-w-0 select-text border-none bg-transparent p-0 outline-none',
        column.type === 'number'
          ? 'font-mono text-[12px] text-[var(--text-secondary)]'
          : column.type === 'date'
            ? 'text-[12px] text-[var(--text-secondary)]'
            : 'text-[13px] text-[var(--text-primary)]'
      )}
    />
  )
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
              <span className='text-[11px] text-[var(--text-tertiary)] tabular-nums'>
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

interface PlaceholderRowsProps {
  columns: ColumnDefinition[]
  dataRowCount: number
  editingEmptyCell: { rowIndex: number; columnName: string } | null
  initialCharacter: string | null
  pendingPlaceholders: Record<number, PendingPlaceholder>
  normalizedSelection: NormalizedSelection | null
  firstRowUnderHeader: boolean
  onClick: (rowIndex: number, columnName: string) => void
  onDoubleClick: (rowIndex: number, columnName: string) => void
  onSave: (rowIndex: number, columnName: string, value: unknown, reason: SaveReason) => void
  onCancel: () => void
  onCellMouseDown: (rowIndex: number, colIndex: number, shiftKey: boolean) => void
  onCellMouseEnter: (rowIndex: number, colIndex: number) => void
  onRowMouseDown: (rowIndex: number, shiftKey: boolean) => void
  onRowMouseEnter: (rowIndex: number) => void
}

function placeholderPropsAreEqual(prev: PlaceholderRowsProps, next: PlaceholderRowsProps): boolean {
  if (
    prev.columns !== next.columns ||
    prev.dataRowCount !== next.dataRowCount ||
    prev.editingEmptyCell !== next.editingEmptyCell ||
    prev.pendingPlaceholders !== next.pendingPlaceholders ||
    prev.firstRowUnderHeader !== next.firstRowUnderHeader ||
    prev.onClick !== next.onClick ||
    prev.onDoubleClick !== next.onDoubleClick ||
    prev.onSave !== next.onSave ||
    prev.onCancel !== next.onCancel ||
    prev.onCellMouseDown !== next.onCellMouseDown ||
    prev.onCellMouseEnter !== next.onCellMouseEnter ||
    prev.onRowMouseDown !== next.onRowMouseDown ||
    prev.onRowMouseEnter !== next.onRowMouseEnter
  ) {
    return false
  }

  const prevSel = prev.normalizedSelection
  const nextSel = next.normalizedSelection
  const dc = prev.dataRowCount
  const maxGlobal = dc + PLACEHOLDER_ROW_COUNT - 1
  const prevOverlaps = prevSel !== null && prevSel.endRow >= dc && prevSel.startRow <= maxGlobal
  const nextOverlaps = nextSel !== null && nextSel.endRow >= dc && nextSel.startRow <= maxGlobal

  if (!prevOverlaps && !nextOverlaps) return true
  if (prevOverlaps !== nextOverlaps) return false

  return (
    prevSel!.startRow === nextSel!.startRow &&
    prevSel!.endRow === nextSel!.endRow &&
    prevSel!.startCol === nextSel!.startCol &&
    prevSel!.endCol === nextSel!.endCol &&
    prevSel!.anchorRow === nextSel!.anchorRow &&
    prevSel!.anchorCol === nextSel!.anchorCol
  )
}

const PlaceholderRows = React.memo(function PlaceholderRows({
  columns,
  dataRowCount,
  editingEmptyCell,
  initialCharacter,
  pendingPlaceholders,
  normalizedSelection,
  firstRowUnderHeader,
  onClick,
  onDoubleClick,
  onSave,
  onCancel,
  onCellMouseDown,
  onCellMouseEnter,
  onRowMouseDown,
  onRowMouseEnter,
}: PlaceholderRowsProps) {
  const sel = normalizedSelection
  const isMultiCell = sel !== null && (sel.startRow !== sel.endRow || sel.startCol !== sel.endCol)

  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 })

  useEffect(() => {
    const container = document.querySelector('[data-table-scroll]') as HTMLElement | null
    if (!container) return

    let rafId: number | null = null
    const update = () => {
      rafId = null
      const scrollTop = container.scrollTop
      const viewportHeight = container.clientHeight
      const placeholderOffset = (dataRowCount + 1) * ROW_HEIGHT_ESTIMATE
      const relTop = Math.max(0, scrollTop - placeholderOffset)
      const start = Math.max(0, Math.floor(relTop / ROW_HEIGHT_ESTIMATE) - PLACEHOLDER_OVERSCAN)
      const end = Math.min(
        PLACEHOLDER_ROW_COUNT,
        Math.ceil((relTop + viewportHeight) / ROW_HEIGHT_ESTIMATE) + PLACEHOLDER_OVERSCAN
      )
      setVisibleRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
    }
    const onScroll = () => {
      if (rafId === null) rafId = requestAnimationFrame(update)
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      container.removeEventListener('scroll', onScroll)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [dataRowCount])

  let renderStart = visibleRange.start
  let renderEnd = visibleRange.end

  if (sel) {
    const sStart = Math.max(0, sel.startRow - dataRowCount)
    const sEnd = sel.endRow - dataRowCount + 1
    if (sEnd > 0 && sStart < PLACEHOLDER_ROW_COUNT) {
      renderStart = Math.min(renderStart, Math.max(0, sStart))
      renderEnd = Math.max(renderEnd, Math.min(PLACEHOLDER_ROW_COUNT, sEnd))
    }
    if (sel.anchorRow >= dataRowCount) {
      const ai = sel.anchorRow - dataRowCount
      if (ai >= 0 && ai < PLACEHOLDER_ROW_COUNT) {
        renderStart = Math.min(renderStart, ai)
        renderEnd = Math.max(renderEnd, ai + 1)
      }
    }
  }

  if (editingEmptyCell) {
    renderStart = Math.min(renderStart, editingEmptyCell.rowIndex)
    renderEnd = Math.max(renderEnd, editingEmptyCell.rowIndex + 1)
  }

  for (const key of Object.keys(pendingPlaceholders)) {
    const idx = Number(key)
    renderStart = Math.min(renderStart, idx)
    renderEnd = Math.max(renderEnd, idx + 1)
  }

  renderStart = Math.max(0, renderStart)
  renderEnd = Math.min(PLACEHOLDER_ROW_COUNT, renderEnd)

  const topHeight = renderStart * ROW_HEIGHT_ESTIMATE
  const bottomHeight = (PLACEHOLDER_ROW_COUNT - renderEnd) * ROW_HEIGHT_ESTIMATE
  const spacerColSpan = columns.length + 2

  return (
    <>
      {topHeight > 0 && (
        <tr aria-hidden>
          <td
            colSpan={spacerColSpan}
            style={{ height: `${topHeight}px`, padding: 0, border: 'none' }}
          />
        </tr>
      )}
      {Array.from({ length: renderEnd - renderStart }).map((_, offset) => {
        const i = renderStart + offset
        const globalRowIndex = dataRowCount + i
        const pending = pendingPlaceholders[i]
        return (
          <tr key={`placeholder-${i}`}>
            <td
              className={cn(CELL_CHECKBOX, 'cursor-pointer text-center')}
              onMouseDown={(e) => {
                if (e.button !== 0) return
                onRowMouseDown(globalRowIndex, e.shiftKey)
              }}
              onMouseEnter={() => onRowMouseEnter(globalRowIndex)}
            >
              <span className='text-[11px] text-[var(--text-tertiary)] tabular-nums'>
                {dataRowCount + i + 1}
              </span>
            </td>
            {columns.map((col, colIndex) => {
              const isEditing =
                editingEmptyCell?.rowIndex === i && editingEmptyCell.columnName === col.name
              const pendingValue = pending?.data[col.name]
              const hasPendingValue = pendingValue !== undefined && pendingValue !== null
              const inRange =
                sel !== null &&
                globalRowIndex >= sel.startRow &&
                globalRowIndex <= sel.endRow &&
                colIndex >= sel.startCol &&
                colIndex <= sel.endCol
              const isAnchor =
                sel !== null && globalRowIndex === sel.anchorRow && colIndex === sel.anchorCol

              const isTopEdge = inRange && globalRowIndex === sel!.startRow
              const isBottomEdge = inRange && globalRowIndex === sel!.endRow
              const isLeftEdge = inRange && colIndex === sel!.startCol
              const isRightEdge = inRange && colIndex === sel!.endCol
              const belowHeader = firstRowUnderHeader && i === 0

              return (
                <td
                  key={col.name}
                  data-row={globalRowIndex}
                  data-col={colIndex}
                  className={cn(CELL, (inRange || isAnchor) && 'relative')}
                  onMouseDown={(e) => {
                    if (e.button !== 0 || isEditing) return
                    onCellMouseDown(globalRowIndex, colIndex, e.shiftKey)
                  }}
                  onMouseEnter={() => onCellMouseEnter(globalRowIndex, colIndex)}
                  onClick={() => onClick(i, col.name)}
                  onDoubleClick={() => onDoubleClick(i, col.name)}
                >
                  {inRange && isMultiCell && (
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
                  {isEditing ? (
                    <div className={CELL_CONTENT}>
                      <InlineEditor
                        value={hasPendingValue ? pendingValue : null}
                        column={col}
                        initialCharacter={initialCharacter ?? undefined}
                        onSave={(value, reason) => onSave(i, col.name, value, reason)}
                        onCancel={onCancel}
                      />
                    </div>
                  ) : hasPendingValue ? (
                    <div className={CELL_CONTENT}>
                      <CellContent
                        value={pendingValue}
                        column={col}
                        isEditing={false}
                        onSave={() => {}}
                        onCancel={() => {}}
                      />
                    </div>
                  ) : (
                    <div className='min-h-[20px]' />
                  )}
                </td>
              )
            })}
          </tr>
        )
      })}
      {bottomHeight > 0 && (
        <tr aria-hidden>
          <td
            colSpan={spacerColSpan}
            style={{ height: `${bottomHeight}px`, padding: 0, border: 'none' }}
          />
        </tr>
      )}
    </>
  )
}, placeholderPropsAreEqual)

const COLUMN_TYPE_OPTIONS: { type: string; label: string; icon: React.ElementType }[] = [
  { type: 'string', label: 'Text', icon: TypeText },
  { type: 'number', label: 'Number', icon: TypeNumber },
  { type: 'boolean', label: 'Boolean', icon: TypeBoolean },
  { type: 'date', label: 'Date', icon: CalendarIcon },
  { type: 'json', label: 'JSON', icon: TypeJson },
]

const ColumnHeaderMenu = React.memo(function ColumnHeaderMenu({
  column,
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
  onToggleRequired,
  onDeleteColumn,
  onResizeStart,
  onResize,
  onResizeEnd,
}: {
  column: ColumnDefinition
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
  onToggleRequired: (columnName: string) => void
  onDeleteColumn: (columnName: string) => void
  onResizeStart: (columnName: string) => void
  onResize: (columnName: string, width: number) => void
  onResizeEnd: () => void
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

      const handlePointerUp = () => {
        target.removeEventListener('pointermove', handlePointerMove)
        target.removeEventListener('pointerup', handlePointerUp)
        onResizeEnd()
      }

      target.addEventListener('pointermove', handlePointerMove)
      target.addEventListener('pointerup', handlePointerUp)
    },
    [column.name, onResizeStart, onResize, onResizeEnd]
  )

  return (
    <th className='relative border-[var(--border)] border-r border-b bg-white p-0 text-left align-middle dark:bg-[var(--bg)]'>
      {isRenaming ? (
        <div className='flex h-full w-full min-w-0 items-center px-[8px] py-[7px]'>
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
            className='ml-[6px] min-w-0 flex-1 border-0 bg-transparent p-0 font-medium text-[13px] text-[var(--text-primary)] outline-none focus:outline-none focus:ring-0'
          />
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              className='flex h-full w-full min-w-0 cursor-pointer items-center px-[8px] py-[7px] outline-none'
            >
              <ColumnTypeIcon type={column.type} />
              <span className='ml-[6px] min-w-0 truncate font-medium text-[13px] text-[var(--text-primary)]'>
                {column.name}
              </span>
              <ChevronDown className='ml-[8px] h-[7px] w-[9px] shrink-0 text-[var(--text-muted)]' />
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
              <Key />
              {column.unique ? 'Remove unique' : 'Set unique'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToggleRequired(column.name)}>
              <Asterisk />
              {column.required ? 'Remove required' : 'Set required'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onDeleteColumn(column.name)}
              className='text-[var(--text-error)] focus:text-[var(--text-error)]'
            >
              <Trash />
              Delete column
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <div
        className='-right-[3px] absolute top-0 z-[1] h-full w-[6px] cursor-col-resize'
        onPointerDown={handleResizePointerDown}
      />
    </th>
  )
})

function ColumnTypeIcon({ type }: { type: string }) {
  const Icon = COLUMN_TYPE_ICONS[type] ?? TypeText
  return <Icon className='h-3 w-3 shrink-0 text-[var(--text-icon)]' />
}
