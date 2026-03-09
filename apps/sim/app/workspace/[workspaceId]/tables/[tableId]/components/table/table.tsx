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
import type { ColumnDefinition, SortDirection, TableRow as TableRowType } from '@/lib/table'
import { ResourceHeader, ResourceOptionsBar } from '@/app/workspace/[workspaceId]/components'
import type {
  ColumnOption,
  FilterConfig,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-options-bar'
import { useAddTableColumn, useCreateTableRow, useUpdateTableRow } from '@/hooks/queries/tables'
import { useContextMenu, useRowSelection, useTableData } from '../../hooks'
import type { EditingCell, QueryOptions } from '../../types'
import { cleanCellValue, formatValueForInput } from '../../utils'
import { ContextMenu } from '../context-menu'
import { RowModal } from '../row-modal'
import { SchemaModal } from '../schema-modal'

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
const PLACEHOLDER_ROW_COUNT = 50
const COL_WIDTH = 160
const CHECKBOX_COL_WIDTH = 40
const ADD_COL_WIDTH = 120
const SKELETON_COL_COUNT = 4
const SKELETON_ROW_COUNT = 10

const CELL = 'border-[var(--border)] border-r border-b px-[8px] py-[7px] align-middle select-none'
const CELL_CHECKBOX =
  'border-[var(--border)] border-r border-b px-[12px] py-[7px] align-middle select-none'
const CELL_HEADER =
  'border-[var(--border)] border-r border-b bg-white px-[8px] py-[7px] text-left align-middle dark:bg-[var(--bg)]'
const CELL_HEADER_CHECKBOX =
  'border-[var(--border)] border-r border-b bg-white px-[12px] py-[7px] text-left align-middle dark:bg-[var(--bg)]'
const CELL_CONTENT =
  'relative min-h-[20px] min-w-0 overflow-clip text-ellipsis whitespace-nowrap text-[13px]'
const SELECTION_OVERLAY =
  'pointer-events-none absolute -top-px -right-px -bottom-px -left-px z-[5] border-[2px] border-[var(--selection)]'

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

export function Table() {
  const params = useParams()
  const router = useRouter()

  const workspaceId = params.workspaceId as string
  const tableId = params.tableId as string

  const [queryOptions, setQueryOptions] = useState<QueryOptions>({
    filter: null,
    sort: null,
  })
  const [currentPage, setCurrentPage] = useState(0)

  const [showAddModal, setShowAddModal] = useState(false)
  const [editingRow, setEditingRow] = useState<TableRowType | null>(null)
  const [deletingRows, setDeletingRows] = useState<string[]>([])
  const [showSchemaModal, setShowSchemaModal] = useState(false)
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [selectionAnchor, setSelectionAnchor] = useState<CellCoord | null>(null)
  const [selectionFocus, setSelectionFocus] = useState<CellCoord | null>(null)
  const [pendingPlaceholders, setPendingPlaceholders] = useState<
    Record<number, PendingPlaceholder>
  >({})

  const [editingEmptyCell, setEditingEmptyCell] = useState<{
    rowIndex: number
    columnName: string
  } | null>(null)

  const isDraggingRef = useRef(false)

  const { tableData, isLoadingTable, rows, totalCount, totalPages, isLoadingRows } = useTableData({
    workspaceId,
    tableId,
    queryOptions,
    currentPage,
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
  const tableWidth = CHECKBOX_COL_WIDTH + displayColCount * COL_WIDTH + ADD_COL_WIDTH
  const selectedCount = selectedRows.size
  const hasSelection = selectedCount > 0
  const isAllSelected = visibleRows.length > 0 && selectedCount === visibleRows.length

  const columnsRef = useRef(columns)
  const rowsRef = useRef(rows)
  const visibleRowsRef = useRef(visibleRows)
  const pendingPlaceholdersRef = useRef(pendingPlaceholders)

  useEffect(() => {
    columnsRef.current = columns
  }, [columns])
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])
  useEffect(() => {
    visibleRowsRef.current = visibleRows
  }, [visibleRows])
  useEffect(() => {
    pendingPlaceholdersRef.current = pendingPlaceholders
  }, [pendingPlaceholders])

  const selectionAnchorRef = useRef(selectionAnchor)
  const selectionFocusRef = useRef(selectionFocus)

  useEffect(() => {
    selectionAnchorRef.current = selectionAnchor
  }, [selectionAnchor])
  useEffect(() => {
    selectionFocusRef.current = selectionFocus
  }, [selectionFocus])

  const handleNavigateBack = useCallback(() => {
    router.push(`/workspace/${workspaceId}/tables`)
  }, [router, workspaceId])

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

  useEffect(() => {
    const handleMouseUp = () => {
      isDraggingRef.current = false
    }
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [])

  const handleCellClick = useCallback((rowId: string, columnName: string) => {
    if (selectionFocusRef.current !== null) return

    const column = columnsRef.current.find((c) => c.name === columnName)
    if (!column) return

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
  }, [])

  const mutateRef = useRef(updateRowMutation.mutate)
  useEffect(() => {
    mutateRef.current = updateRowMutation.mutate
  }, [updateRowMutation.mutate])

  const editingCellRef = useRef(editingCell)
  useEffect(() => {
    editingCellRef.current = editingCell
  }, [editingCell])

  const editingEmptyCellRef = useRef(editingEmptyCell)
  useEffect(() => {
    editingEmptyCellRef.current = editingEmptyCell
  }, [editingEmptyCell])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const anchor = selectionAnchorRef.current
      if (!anchor || editingCellRef.current || editingEmptyCellRef.current) return

      const cols = columnsRef.current
      const dataRows = visibleRowsRef.current
      const totalRows = dataRows.length + PLACEHOLDER_ROW_COUNT

      if (e.key === 'Escape') {
        setSelectionAnchor(null)
        setSelectionFocus(null)
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
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleInlineSave = useCallback((rowId: string, columnName: string, value: unknown) => {
    setEditingCell(null)

    const row = rowsRef.current.find((r) => r.id === rowId)
    if (!row) return

    const oldValue = row.data[columnName]
    if (oldValue === value) return
    if (oldValue === null && value === null) return

    mutateRef.current({ rowId, data: { [columnName]: value } })
  }, [])

  const handleInlineCancel = useCallback(() => {
    setEditingCell(null)
  }, [])

  const handleEmptyRowClick = useCallback((rowIndex: number, columnName: string) => {
    if (selectionFocusRef.current !== null) return

    const column = columnsRef.current.find((c) => c.name === columnName)
    if (!column || column.type === 'json' || column.type === 'boolean') return
    setEditingEmptyCell({ rowIndex, columnName })
  }, [])

  const createRef = useRef(createRowMutation.mutate)
  useEffect(() => {
    createRef.current = createRowMutation.mutate
  }, [createRowMutation.mutate])

  const handleEmptyRowSave = useCallback((rowIndex: number, columnName: string, value: unknown) => {
    setEditingEmptyCell(null)
    if (value === null || value === undefined || value === '') return

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
  }, [])

  const handleEmptyRowCancel = useCallback(() => {
    setEditingEmptyCell(null)
  }, [])

  const handleAddColumn = useCallback(() => {
    const existing = columnsRef.current.map((c) => c.name.toLowerCase())
    let name = 'untitled'
    let i = 2
    while (existing.includes(name.toLowerCase())) {
      name = `untitled_${i}`
      i++
    }
    addColumnMutation.mutate({ name, type: 'string' })
  }, [addColumnMutation])

  const handleRenameColumn = useCallback((_columnName: string) => {}, [])
  const handleChangeType = useCallback((_columnName: string, _newType: string) => {}, [])
  const handleInsertColumnLeft = useCallback((_columnName: string) => {}, [])
  const handleInsertColumnRight = useCallback((_columnName: string) => {}, [])
  const handleToggleUnique = useCallback((_columnName: string) => {}, [])
  const handleToggleRequired = useCallback((_columnName: string) => {}, [])
  const handleDeleteColumn = useCallback((_columnName: string) => {}, [])

  const handleSortChange = useCallback((_column: string, _direction: SortDirection) => {}, [])
  const handleSortClear = useCallback(() => {}, [])
  const handleFilterToggle = useCallback((_column: string, _operator: string) => {}, [])
  const handleFilterClear = useCallback(() => {}, [])

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

  const sortConfig = useMemo<SortConfig>(
    () => ({
      options: columnOptions,
      active: null,
      onSort: handleSortChange,
      onClear: handleSortClear,
    }),
    [columnOptions, handleSortChange, handleSortClear]
  )

  const filterConfig = useMemo<FilterConfig>(
    () => ({
      options: columnOptions,
      active: [],
      onToggle: handleFilterToggle,
      onClear: handleFilterClear,
    }),
    [columnOptions, handleFilterToggle, handleFilterClear]
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
      <ResourceHeader
        icon={TableIcon}
        breadcrumbs={[
          { label: 'Tables', onClick: handleNavigateBack },
          ...(tableData ? [{ label: tableData.name }] : []),
        ]}
      />

      <ResourceOptionsBar sort={sortConfig} filter={filterConfig} />

      <div className='min-h-0 flex-1 overflow-auto overscroll-none' data-table-scroll>
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
            <TableColGroup columns={columns} />
          )}
          <thead className='sticky top-0 z-10'>
            {isLoadingTable ? (
              <tr>
                <th className={CELL_HEADER_CHECKBOX}>
                  <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />
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
                  <Checkbox size='sm' checked={isAllSelected} onCheckedChange={handleSelectAll} />
                </th>
                {columns.map((column) => (
                  <ColumnHeaderMenu
                    key={column.name}
                    column={column}
                    onRenameColumn={handleRenameColumn}
                    onChangeType={handleChangeType}
                    onInsertLeft={handleInsertColumnLeft}
                    onInsertRight={handleInsertColumnRight}
                    onToggleUnique={handleToggleUnique}
                    onToggleRequired={handleToggleRequired}
                    onDeleteColumn={handleDeleteColumn}
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
                      Add column
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
                    isSelected={selectedRows.has(row.id)}
                    editingColumnName={
                      editingCell?.rowId === row.id ? editingCell.columnName : null
                    }
                    normalizedSelection={normalizedSelection}
                    onClick={handleCellClick}
                    onSave={handleInlineSave}
                    onCancel={handleInlineCancel}
                    onContextMenu={handleRowContextMenu}
                    onSelectRow={handleSelectRow}
                    onCellMouseDown={handleCellMouseDown}
                    onCellMouseEnter={handleCellMouseEnter}
                  />
                ))}
                <PlaceholderRows
                  columns={columns}
                  dataRowCount={visibleRows.length}
                  editingEmptyCell={editingEmptyCell}
                  pendingPlaceholders={pendingPlaceholders}
                  normalizedSelection={normalizedSelection}
                  firstRowUnderHeader={visibleRows.length === 0}
                  onClick={handleEmptyRowClick}
                  onSave={handleEmptyRowSave}
                  onCancel={handleEmptyRowCancel}
                  onCellMouseDown={handleCellMouseDown}
                  onCellMouseEnter={handleCellMouseEnter}
                />
              </>
            )}
          </tbody>
        </table>
      </div>

      <TablePagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalCount={totalCount}
        onPreviousPage={() => setCurrentPage((p) => Math.max(0, p - 1))}
        onNextPage={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
      />

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
    </div>
  )
}

function TableColGroup({ columns }: { columns: ColumnDefinition[] }) {
  return (
    <colgroup>
      <col style={{ width: CHECKBOX_COL_WIDTH }} />
      {columns.map((col) => (
        <col key={col.name} style={{ width: COL_WIDTH }} />
      ))}
      <col style={{ width: ADD_COL_WIDTH }} />
    </colgroup>
  )
}

const DataRow = React.memo(function DataRow({
  row,
  columns,
  rowIndex,
  isFirstRow,
  isSelected,
  editingColumnName,
  normalizedSelection,
  onClick,
  onSave,
  onCancel,
  onContextMenu,
  onSelectRow,
  onCellMouseDown,
  onCellMouseEnter,
}: {
  row: TableRowType
  columns: ColumnDefinition[]
  rowIndex: number
  isFirstRow: boolean
  isSelected: boolean
  editingColumnName: string | null
  normalizedSelection: NormalizedSelection | null
  onClick: (rowId: string, columnName: string) => void
  onSave: (rowId: string, columnName: string, value: unknown) => void
  onCancel: () => void
  onContextMenu: (e: React.MouseEvent, row: TableRowType) => void
  onSelectRow: (rowId: string) => void
  onCellMouseDown: (rowIndex: number, colIndex: number, shiftKey: boolean) => void
  onCellMouseEnter: (rowIndex: number, colIndex: number) => void
}) {
  const sel = normalizedSelection
  const isMultiCell = sel !== null && (sel.startRow !== sel.endRow || sel.startCol !== sel.endCol)

  return (
    <tr
      className={cn('group', isSelected && 'bg-[var(--surface-5)]')}
      onContextMenu={(e) => onContextMenu(e, row)}
    >
      <td className={CELL_CHECKBOX}>
        <Checkbox size='sm' checked={isSelected} onCheckedChange={() => onSelectRow(row.id)} />
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
            className={cn(CELL, (inRange || isAnchor) && 'relative')}
            onMouseDown={(e) => {
              if (e.button !== 0 || isEditing) return
              onCellMouseDown(rowIndex, colIndex, e.shiftKey)
            }}
            onMouseEnter={() => onCellMouseEnter(rowIndex, colIndex)}
            onClick={() => onClick(row.id, column.name)}
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
                onSave={(value) => onSave(row.id, column.name, value)}
                onCancel={onCancel}
              />
            </div>
          </td>
        )
      })}
    </tr>
  )
})

function CellContent({
  value,
  column,
  isEditing,
  onSave,
  onCancel,
}: {
  value: unknown
  column: ColumnDefinition
  isEditing: boolean
  onSave: (value: unknown) => void
  onCancel: () => void
}) {
  if (isEditing) {
    return <InlineEditor value={value} column={column} onSave={onSave} onCancel={onCancel} />
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
  onSave,
  onCancel,
}: {
  value: unknown
  column: ColumnDefinition
  onSave: (value: unknown) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(() => formatValueForInput(value, column.type))
  const doneRef = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return

    input.focus()
    input.select()

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

  const handleSave = () => {
    if (doneRef.current) return
    doneRef.current = true
    try {
      onSave(cleanCellValue(draft, column))
    } catch {
      onCancel()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
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
      onBlur={handleSave}
      className={cn(
        'h-full w-full min-w-0 select-text border-none bg-transparent p-0 outline-none',
        column.type === 'number'
          ? 'font-mono text-[12px] text-[var(--text-secondary)]'
          : column.type === 'date'
            ? 'text-[12px] text-[var(--text-secondary)]'
            : 'text-[13px] text-[var(--text-primary)]'
      )}
    />
  )
}

function TablePagination({
  currentPage,
  totalPages,
  totalCount,
  onPreviousPage,
  onNextPage,
}: {
  currentPage: number
  totalPages: number
  totalCount: number
  onPreviousPage: () => void
  onNextPage: () => void
}) {
  if (totalPages <= 1) return null

  return (
    <div className='flex h-[40px] shrink-0 items-center justify-between border-[var(--border)] border-t px-[16px]'>
      <span className='text-[11px] text-[var(--text-tertiary)]'>
        Page {currentPage + 1} of {totalPages} ({totalCount} rows)
      </span>
      <div className='flex items-center gap-[4px]'>
        <Button variant='ghost' size='sm' onClick={onPreviousPage} disabled={currentPage === 0}>
          Previous
        </Button>
        <Button
          variant='ghost'
          size='sm'
          onClick={onNextPage}
          disabled={currentPage === totalPages - 1}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

function TableBodySkeleton({ colCount }: { colCount: number }) {
  return (
    <>
      {Array.from({ length: SKELETON_ROW_COUNT }).map((_, rowIndex) => (
        <tr key={rowIndex}>
          <td className={CELL_CHECKBOX}>
            <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />
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
}

function PlaceholderRows({
  columns,
  dataRowCount,
  editingEmptyCell,
  pendingPlaceholders,
  normalizedSelection,
  firstRowUnderHeader,
  onClick,
  onSave,
  onCancel,
  onCellMouseDown,
  onCellMouseEnter,
}: {
  columns: ColumnDefinition[]
  dataRowCount: number
  editingEmptyCell: { rowIndex: number; columnName: string } | null
  pendingPlaceholders: Record<number, PendingPlaceholder>
  normalizedSelection: NormalizedSelection | null
  firstRowUnderHeader: boolean
  onClick: (rowIndex: number, columnName: string) => void
  onSave: (rowIndex: number, columnName: string, value: unknown) => void
  onCancel: () => void
  onCellMouseDown: (rowIndex: number, colIndex: number, shiftKey: boolean) => void
  onCellMouseEnter: (rowIndex: number, colIndex: number) => void
}) {
  const sel = normalizedSelection
  const isMultiCell = sel !== null && (sel.startRow !== sel.endRow || sel.startCol !== sel.endCol)

  return (
    <>
      {Array.from({ length: PLACEHOLDER_ROW_COUNT }).map((_, i) => {
        const globalRowIndex = dataRowCount + i
        const pending = pendingPlaceholders[i]
        return (
          <tr key={`placeholder-${i}`}>
            <td className={CELL_CHECKBOX} />
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
                  className={cn(CELL, (inRange || isAnchor) && 'relative')}
                  onMouseDown={(e) => {
                    if (e.button !== 0 || isEditing) return
                    onCellMouseDown(globalRowIndex, colIndex, e.shiftKey)
                  }}
                  onMouseEnter={() => onCellMouseEnter(globalRowIndex, colIndex)}
                  onClick={() => onClick(i, col.name)}
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
                    <InlineEditor
                      value={hasPendingValue ? pendingValue : null}
                      column={col}
                      onSave={(value) => onSave(i, col.name, value)}
                      onCancel={onCancel}
                    />
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
    </>
  )
}

const COLUMN_TYPE_OPTIONS: { type: string; label: string; icon: React.ElementType }[] = [
  { type: 'string', label: 'Text', icon: TypeText },
  { type: 'number', label: 'Number', icon: TypeNumber },
  { type: 'boolean', label: 'Boolean', icon: TypeBoolean },
  { type: 'date', label: 'Date', icon: CalendarIcon },
  { type: 'json', label: 'JSON', icon: TypeJson },
]

function ColumnHeaderMenu({
  column,
  onRenameColumn,
  onChangeType,
  onInsertLeft,
  onInsertRight,
  onToggleUnique,
  onToggleRequired,
  onDeleteColumn,
}: {
  column: ColumnDefinition
  onRenameColumn: (columnName: string) => void
  onChangeType: (columnName: string, newType: string) => void
  onInsertLeft: (columnName: string) => void
  onInsertRight: (columnName: string) => void
  onToggleUnique: (columnName: string) => void
  onToggleRequired: (columnName: string) => void
  onDeleteColumn: (columnName: string) => void
}) {
  return (
    <th className='border-[var(--border)] border-r border-b bg-white p-0 text-left align-middle dark:bg-[var(--bg)]'>
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
    </th>
  )
}

function ColumnTypeIcon({ type }: { type: string }) {
  const Icon = COLUMN_TYPE_ICONS[type] ?? TypeText
  return <Icon className='h-3 w-3 shrink-0 text-[var(--text-icon)]' />
}
