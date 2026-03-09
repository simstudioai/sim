'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Checkbox, Skeleton } from '@/components/emcn'
import {
  Calendar as CalendarIcon,
  Plus,
  Table as TableIcon,
  TypeBoolean,
  TypeJson,
  TypeNumber,
  TypeText,
} from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import type { ColumnDefinition, TableRow as TableRowType } from '@/lib/table'
import { ResourceHeader, ResourceOptionsBar } from '@/app/workspace/[workspaceId]/components'
import { useAddTableColumn, useCreateTableRow, useUpdateTableRow } from '@/hooks/queries/tables'
import { useContextMenu, useRowSelection, useTableData } from '../../hooks'
import type { EditingCell, QueryOptions } from '../../types'
import { cleanCellValue, formatValueForInput } from '../../utils'
import { ContextMenu } from '../context-menu'
import { RowModal } from '../row-modal'
import { SchemaModal } from '../schema-modal'

type SelectedCell =
  | { kind: 'data'; rowId: string; columnName: string }
  | { kind: 'placeholder'; index: number; columnName: string }

interface PendingPlaceholder {
  rowId: string | null
  data: Record<string, unknown>
}

const EMPTY_COLUMNS: never[] = []
const PLACEHOLDER_ROW_COUNT = 50
const COL_WIDTH = 160
const CHECKBOX_COL_WIDTH = 40
const ADD_COL_WIDTH = 120

const CELL = 'border-[var(--border)] border-r border-b px-[8px] py-[7px] align-middle'
const CELL_CHECKBOX = 'border-[var(--border)] border-r border-b px-[12px] py-[7px] align-middle'
const CELL_HEADER =
  'border-[var(--border)] border-r border-b bg-white px-[8px] py-[7px] text-left align-middle dark:bg-[var(--bg)]'
const CELL_HEADER_CHECKBOX =
  'border-[var(--border)] border-r border-b bg-white px-[12px] py-[7px] text-left align-middle dark:bg-[var(--bg)]'
const CELL_CONTENT = 'relative min-h-[20px] min-w-0 overflow-hidden truncate text-[13px]'
const SELECTION_OVERLAY =
  'pointer-events-none absolute -top-px -right-px -bottom-px -left-px border-2 border-[var(--brand-tertiary-2)]'

const COLUMN_TYPE_ICONS: Record<string, React.ElementType> = {
  string: TypeText,
  number: TypeNumber,
  boolean: TypeBoolean,
  date: CalendarIcon,
  json: TypeJson,
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
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null)
  const [pendingPlaceholders, setPendingPlaceholders] = useState<
    Record<number, PendingPlaceholder>
  >({})

  const [editingEmptyCell, setEditingEmptyCell] = useState<{
    rowIndex: number
    columnName: string
  } | null>(null)

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

  const tableWidth = CHECKBOX_COL_WIDTH + columns.length * COL_WIDTH + ADD_COL_WIDTH
  const selectedCount = selectedRows.size
  const hasSelection = selectedCount > 0
  const isAllSelected = visibleRows.length > 0 && selectedCount === visibleRows.length

  const columnsRef = useRef(columns)
  const rowsRef = useRef(rows)
  const pendingPlaceholdersRef = useRef(pendingPlaceholders)

  useEffect(() => {
    columnsRef.current = columns
  }, [columns])
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])
  useEffect(() => {
    pendingPlaceholdersRef.current = pendingPlaceholders
  }, [pendingPlaceholders])

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

  const handleSelectCell = useCallback((rowId: string, columnName: string) => {
    setSelectedCell({ kind: 'data', rowId, columnName })
  }, [])

  const handleSelectPlaceholderCell = useCallback((index: number, columnName: string) => {
    setSelectedCell({ kind: 'placeholder', index, columnName })
  }, [])

  const handleCellDoubleClick = useCallback((rowId: string, columnName: string) => {
    setSelectedCell({ kind: 'data', rowId, columnName })

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

  const selectedCellRef = useRef(selectedCell)
  useEffect(() => {
    selectedCellRef.current = selectedCell
  }, [selectedCell])

  const editingCellRef = useRef(editingCell)
  useEffect(() => {
    editingCellRef.current = editingCell
  }, [editingCell])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const sel = selectedCellRef.current
      if (!sel || sel.kind !== 'data' || editingCellRef.current) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        mutateRef.current({ rowId: sel.rowId, data: { [sel.columnName]: null } })
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault()
        const row = rowsRef.current.find((r) => r.id === sel.rowId)
        if (row) {
          const value = row.data[sel.columnName]
          let text = ''
          if (value !== null && value !== undefined) {
            text = typeof value === 'object' ? JSON.stringify(value) : String(value)
          }
          navigator.clipboard.writeText(text)
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        e.preventDefault()
        navigator.clipboard.readText().then((text) => {
          const current = selectedCellRef.current
          if (!current || current.kind !== 'data') return
          const column = columnsRef.current.find((c) => c.name === current.columnName)
          if (!column) return
          try {
            const cleaned = cleanCellValue(text, column)
            mutateRef.current({ rowId: current.rowId, data: { [current.columnName]: cleaned } })
          } catch {
            // ignore invalid paste values
          }
        })
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

  const handleEmptyRowDoubleClick = useCallback((rowIndex: number, columnName: string) => {
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

  if (isLoadingTable) {
    return (
      <div className='flex h-full items-center justify-center'>
        <span className='text-[13px] text-[var(--text-tertiary)]'>Loading table...</span>
      </div>
    )
  }

  if (!tableData) {
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
        breadcrumbs={[{ label: 'Tables', onClick: handleNavigateBack }, { label: tableData.name }]}
      />

      <ResourceOptionsBar onSort={() => {}} onFilter={() => {}} />

      <div className='min-h-0 flex-1 overflow-auto overscroll-none'>
        <table
          className='table-fixed border-separate border-spacing-0 text-[13px]'
          style={{ width: `${tableWidth}px` }}
        >
          <TableColGroup columns={columns} />
          <thead className='sticky top-0 z-10'>
            <tr>
              <th className={CELL_HEADER_CHECKBOX}>
                <Checkbox size='sm' checked={isAllSelected} onCheckedChange={handleSelectAll} />
              </th>
              {columns.map((column) => (
                <th key={column.name} className={CELL_HEADER}>
                  <div className='flex min-w-0 items-center gap-[8px]'>
                    <ColumnTypeIcon type={column.type} />
                    <span className='min-w-0 truncate font-medium text-[13px] text-[var(--text-primary)]'>
                      {column.name}
                    </span>
                  </div>
                </th>
              ))}
              <th className={CELL_HEADER}>
                <button
                  type='button'
                  className='flex cursor-pointer items-center gap-[8px]'
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
          </thead>
          <tbody>
            {isLoadingRows ? (
              <TableSkeleton columns={columns} />
            ) : (
              <>
                {visibleRows.map((row) => (
                  <DataRow
                    key={row.id}
                    row={row}
                    columns={columns}
                    isSelected={selectedRows.has(row.id)}
                    editingColumnName={
                      editingCell?.rowId === row.id ? editingCell.columnName : null
                    }
                    selectedColumnName={
                      selectedCell?.kind === 'data' && selectedCell.rowId === row.id
                        ? selectedCell.columnName
                        : null
                    }
                    onDoubleClick={handleCellDoubleClick}
                    onSave={handleInlineSave}
                    onCancel={handleInlineCancel}
                    onContextMenu={handleRowContextMenu}
                    onSelectRow={handleSelectRow}
                    onSelectCell={handleSelectCell}
                  />
                ))}
                <PlaceholderRows
                  columns={columns}
                  editingEmptyCell={editingEmptyCell}
                  pendingPlaceholders={pendingPlaceholders}
                  selectedCell={selectedCell}
                  onDoubleClick={handleEmptyRowDoubleClick}
                  onSave={handleEmptyRowSave}
                  onCancel={handleEmptyRowCancel}
                  onSelectCell={handleSelectPlaceholderCell}
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

      {showAddModal && (
        <RowModal
          mode='add'
          isOpen={true}
          onClose={() => setShowAddModal(false)}
          table={tableData}
          onSuccess={() => setShowAddModal(false)}
        />
      )}

      {editingRow && (
        <RowModal
          mode='edit'
          isOpen={true}
          onClose={() => setEditingRow(null)}
          table={tableData}
          row={editingRow}
          onSuccess={() => setEditingRow(null)}
        />
      )}

      {deletingRows.length > 0 && (
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

      <SchemaModal
        isOpen={showSchemaModal}
        onClose={() => setShowSchemaModal(false)}
        columns={columns}
        tableName={tableData.name}
      />

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

function SelectionOverlay() {
  return <div className={SELECTION_OVERLAY} />
}

const DataRow = React.memo(function DataRow({
  row,
  columns,
  isSelected,
  editingColumnName,
  selectedColumnName,
  onDoubleClick,
  onSave,
  onCancel,
  onContextMenu,
  onSelectRow,
  onSelectCell,
}: {
  row: TableRowType
  columns: ColumnDefinition[]
  isSelected: boolean
  editingColumnName: string | null
  selectedColumnName: string | null
  onDoubleClick: (rowId: string, columnName: string) => void
  onSave: (rowId: string, columnName: string, value: unknown) => void
  onCancel: () => void
  onContextMenu: (e: React.MouseEvent, row: TableRowType) => void
  onSelectRow: (rowId: string) => void
  onSelectCell: (rowId: string, columnName: string) => void
}) {
  return (
    <tr
      className={cn('group', isSelected && 'bg-[var(--surface-5)]')}
      onContextMenu={(e) => onContextMenu(e, row)}
    >
      <td className={CELL_CHECKBOX}>
        <Checkbox size='sm' checked={isSelected} onCheckedChange={() => onSelectRow(row.id)} />
      </td>
      {columns.map((column) => {
        const isColumnSelected = selectedColumnName === column.name
        return (
          <td
            key={column.name}
            className={cn(CELL, isColumnSelected && 'relative z-[11]')}
            onClick={() => onSelectCell(row.id, column.name)}
            onDoubleClick={() => onDoubleClick(row.id, column.name)}
          >
            {isColumnSelected && <SelectionOverlay />}
            <div className={CELL_CONTENT}>
              <CellContent
                value={row.data[column.name]}
                column={column}
                isEditing={editingColumnName === column.name}
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
    if (input) {
      input.focus()
      input.select()
    }
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
        'h-full w-full min-w-0 border-none bg-transparent p-0 outline-none',
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

function TableSkeleton({ columns }: { columns: ColumnDefinition[] }) {
  return (
    <>
      {Array.from({ length: 25 }).map((_, rowIndex) => (
        <tr key={rowIndex}>
          <td className={CELL_CHECKBOX}>
            <Skeleton className='h-[14px] w-[14px]' />
          </td>
          {columns.map((col, colIndex) => {
            const baseWidth =
              col.type === 'json'
                ? 200
                : col.type === 'string'
                  ? 160
                  : col.type === 'number'
                    ? 80
                    : col.type === 'boolean'
                      ? 50
                      : col.type === 'date'
                        ? 100
                        : 120
            const width = baseWidth + ((rowIndex + colIndex) % 3) * 20

            return (
              <td key={col.name} className={CELL}>
                <Skeleton className='h-[16px]' style={{ width: `${width}px` }} />
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
  editingEmptyCell,
  pendingPlaceholders,
  selectedCell,
  onDoubleClick,
  onSave,
  onCancel,
  onSelectCell,
}: {
  columns: ColumnDefinition[]
  editingEmptyCell: { rowIndex: number; columnName: string } | null
  pendingPlaceholders: Record<number, PendingPlaceholder>
  selectedCell: SelectedCell | null
  onDoubleClick: (rowIndex: number, columnName: string) => void
  onSave: (rowIndex: number, columnName: string, value: unknown) => void
  onCancel: () => void
  onSelectCell: (index: number, columnName: string) => void
}) {
  return (
    <>
      {Array.from({ length: PLACEHOLDER_ROW_COUNT }).map((_, i) => {
        const pending = pendingPlaceholders[i]
        return (
          <tr key={`placeholder-${i}`}>
            <td className={CELL_CHECKBOX} />
            {columns.map((col) => {
              const isEditing =
                editingEmptyCell?.rowIndex === i && editingEmptyCell.columnName === col.name
              const pendingValue = pending?.data[col.name]
              const hasPendingValue = pendingValue !== undefined && pendingValue !== null
              const isColumnSelected =
                selectedCell?.kind === 'placeholder' &&
                selectedCell.index === i &&
                selectedCell.columnName === col.name

              return (
                <td
                  key={col.name}
                  className={cn(CELL, isColumnSelected && 'relative z-[11]')}
                  onClick={() => onSelectCell(i, col.name)}
                  onDoubleClick={() => onDoubleClick(i, col.name)}
                >
                  {isColumnSelected && <SelectionOverlay />}
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

function ColumnTypeIcon({ type }: { type: string }) {
  const Icon = COLUMN_TYPE_ICONS[type] ?? TypeText
  return <Icon className='h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
}
