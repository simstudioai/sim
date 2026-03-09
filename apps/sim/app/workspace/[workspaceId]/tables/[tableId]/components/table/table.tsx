'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Checkbox, Skeleton } from '@/components/emcn'
import {
  Calendar as CalendarIcon,
  Table as TableIcon,
  TypeBoolean,
  TypeJson,
  TypeNumber,
  TypeText,
} from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import type { ColumnDefinition, TableRow as TableRowType } from '@/lib/table'
import { ResourceHeader, ResourceOptionsBar } from '@/app/workspace/[workspaceId]/components'
import { useCreateTableRow, useUpdateTableRow } from '@/hooks/queries/tables'
import { STRING_TRUNCATE_LENGTH } from '../../constants'
import { useContextMenu, useRowSelection, useTableData } from '../../hooks'
import type { CellViewerData, EditingCell, QueryOptions } from '../../types'
import { cleanCellValue, formatValueForInput } from '../../utils'
import { CellViewerModal } from '../cell-viewer-modal'
import { ContextMenu } from '../context-menu'
import { RowModal } from '../row-modal'
import { SchemaModal } from '../schema-modal'

const EMPTY_COLUMNS: never[] = []

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

  const [editingEmptyCell, setEditingEmptyCell] = useState<{
    rowIndex: number
    columnName: string
  } | null>(null)

  const [cellViewer, setCellViewer] = useState<CellViewerData | null>(null)
  const [copied, setCopied] = useState(false)

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

  const columns = useMemo(
    () => tableData?.schema?.columns || EMPTY_COLUMNS,
    [tableData?.schema?.columns]
  )
  const selectedCount = selectedRows.size
  const hasSelection = selectedCount > 0
  const isAllSelected = rows.length > 0 && selectedCount === rows.length

  const columnsRef = useRef(columns)
  const rowsRef = useRef(rows)

  useEffect(() => {
    columnsRef.current = columns
  }, [columns])
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const handleNavigateBack = useCallback(() => {
    router.push(`/workspace/${workspaceId}/tables`)
  }, [router, workspaceId])

  const handleAddRow = useCallback(() => {
    setShowAddModal(true)
  }, [])

  const handleSort = useCallback(() => {}, [])

  const handleFilter = useCallback(() => {}, [])

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

  const handleCopyCellValue = useCallback(async () => {
    if (cellViewer) {
      let text: string
      if (cellViewer.type === 'json') {
        text = JSON.stringify(cellViewer.value, null, 2)
      } else if (cellViewer.type === 'date') {
        text = String(cellViewer.value)
      } else {
        text = String(cellViewer.value)
      }
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [cellViewer])

  const handleCellClick = useCallback(
    (columnName: string, value: unknown, type: CellViewerData['type']) => {
      setCellViewer({ columnName, value, type })
    },
    []
  )

  const handleCellDoubleClick = useCallback((rowId: string, columnName: string) => {
    const column = columnsRef.current.find((c) => c.name === columnName)
    if (!column) return

    if (column.type === 'json') {
      const row = rowsRef.current.find((r) => r.id === rowId)
      if (row) setEditingRow(row)
      return
    }

    if (column.type === 'boolean') return

    setEditingCell({ rowId, columnName })
  }, [])

  const mutateRef = useRef(updateRowMutation.mutate)
  useEffect(() => {
    mutateRef.current = updateRowMutation.mutate
  }, [updateRowMutation.mutate])

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

  const handleBooleanToggle = useCallback(
    (rowId: string, columnName: string, currentValue: boolean) => {
      mutateRef.current({ rowId, data: { [columnName]: !currentValue } })
    },
    []
  )

  const handleEmptyRowDoubleClick = useCallback((rowIndex: number, columnName: string) => {
    const column = columnsRef.current.find((c) => c.name === columnName)
    if (!column || column.type === 'json' || column.type === 'boolean') return
    setEditingEmptyCell({ rowIndex, columnName })
  }, [])

  const createRef = useRef(createRowMutation.mutate)
  useEffect(() => {
    createRef.current = createRowMutation.mutate
  }, [createRowMutation.mutate])

  const handleEmptyRowSave = useCallback((columnName: string, value: unknown) => {
    setEditingEmptyCell(null)
    if (value === null || value === undefined || value === '') return
    createRef.current({ [columnName]: value })
  }, [])

  const handleEmptyRowCancel = useCallback(() => {
    setEditingEmptyCell(null)
  }, [])

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

      <ResourceOptionsBar onSort={handleSort} onFilter={handleFilter} />

      <div className='min-h-0 flex-1 overflow-auto overscroll-none'>
        <table className='border-collapse text-[13px]'>
          <colgroup>
            <col className='w-[40px]' />
            {columns.map((col) => (
              <col key={col.name} className='w-[160px]' />
            ))}
          </colgroup>
          <thead className='sticky top-0 z-10 bg-white shadow-[inset_0_-1px_0_var(--border)] dark:bg-[var(--bg)]'>
            <tr>
              <th className='border-[var(--border)] border-r py-[10px] pr-[12px] pl-[24px] text-left align-middle'>
                <Checkbox size='sm' checked={isAllSelected} onCheckedChange={handleSelectAll} />
              </th>
              {columns.map((column) => (
                <th
                  key={column.name}
                  className='border-[var(--border)] border-r px-[24px] py-[10px] text-left align-middle'
                >
                  <div className='flex items-center gap-[8px]'>
                    <ColumnTypeIcon type={column.type} />
                    <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                      {column.name}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoadingRows ? (
              <TableSkeleton columns={columns} />
            ) : (
              <>
                {rows.map((row) => (
                  <DataRow
                    key={row.id}
                    row={row}
                    columns={columns}
                    isSelected={selectedRows.has(row.id)}
                    editingColumnName={
                      editingCell?.rowId === row.id ? editingCell.columnName : null
                    }
                    onCellClick={handleCellClick}
                    onDoubleClick={handleCellDoubleClick}
                    onSave={handleInlineSave}
                    onCancel={handleInlineCancel}
                    onBooleanToggle={handleBooleanToggle}
                    onContextMenu={handleRowContextMenu}
                    onSelectRow={handleSelectRow}
                  />
                ))}
                <PlaceholderRows
                  columns={columns}
                  editingEmptyCell={editingEmptyCell}
                  onDoubleClick={handleEmptyRowDoubleClick}
                  onSave={handleEmptyRowSave}
                  onCancel={handleEmptyRowCancel}
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
          onSuccess={() => {
            setShowAddModal(false)
          }}
        />
      )}

      {editingRow && (
        <RowModal
          mode='edit'
          isOpen={true}
          onClose={() => setEditingRow(null)}
          table={tableData}
          row={editingRow}
          onSuccess={() => {
            setEditingRow(null)
          }}
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

      <CellViewerModal
        cellViewer={cellViewer}
        onClose={() => setCellViewer(null)}
        onCopy={handleCopyCellValue}
        copied={copied}
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

const DataRow = React.memo(function DataRow({
  row,
  columns,
  isSelected,
  editingColumnName,
  onCellClick,
  onDoubleClick,
  onSave,
  onCancel,
  onBooleanToggle,
  onContextMenu,
  onSelectRow,
}: {
  row: TableRowType
  columns: ColumnDefinition[]
  isSelected: boolean
  editingColumnName: string | null
  onCellClick: (columnName: string, value: unknown, type: CellViewerData['type']) => void
  onDoubleClick: (rowId: string, columnName: string) => void
  onSave: (rowId: string, columnName: string, value: unknown) => void
  onCancel: () => void
  onBooleanToggle: (rowId: string, columnName: string, currentValue: boolean) => void
  onContextMenu: (e: React.MouseEvent, row: TableRowType) => void
  onSelectRow: (rowId: string) => void
}) {
  return (
    <tr
      className={cn('group', isSelected && 'bg-[var(--surface-5)]')}
      onContextMenu={(e) => onContextMenu(e, row)}
    >
      <td className='border-[var(--border)] border-r border-b py-[10px] pr-[12px] pl-[24px] align-middle'>
        <Checkbox size='sm' checked={isSelected} onCheckedChange={() => onSelectRow(row.id)} />
      </td>
      {columns.map((column) => (
        <td
          key={column.name}
          className='border-[var(--border)] border-r border-b px-[24px] py-[10px] align-middle'
        >
          <div className='max-w-[300px] truncate text-[13px]'>
            <CellContent
              value={row.data[column.name]}
              column={column}
              isEditing={editingColumnName === column.name}
              onCellClick={onCellClick}
              onDoubleClick={() => onDoubleClick(row.id, column.name)}
              onSave={(value) => onSave(row.id, column.name, value)}
              onCancel={onCancel}
              onBooleanToggle={() =>
                onBooleanToggle(row.id, column.name, Boolean(row.data[column.name]))
              }
            />
          </div>
        </td>
      ))}
    </tr>
  )
})

function CellContent({
  value,
  column,
  isEditing,
  onCellClick,
  onDoubleClick,
  onSave,
  onCancel,
  onBooleanToggle,
}: {
  value: unknown
  column: ColumnDefinition
  isEditing: boolean
  onCellClick: (columnName: string, value: unknown, type: CellViewerData['type']) => void
  onDoubleClick: () => void
  onSave: (value: unknown) => void
  onCancel: () => void
  onBooleanToggle: () => void
}) {
  if (isEditing) {
    return <InlineEditor value={value} column={column} onSave={onSave} onCancel={onCancel} />
  }

  const isNull = value === null || value === undefined

  if (column.type === 'boolean') {
    const boolValue = Boolean(value)
    return (
      <button
        type='button'
        className='cursor-pointer select-none'
        onClick={(e) => {
          e.stopPropagation()
          onBooleanToggle()
        }}
      >
        <span className={boolValue ? 'text-green-500' : 'text-[var(--text-tertiary)]'}>
          {isNull ? (
            <span className='text-[var(--text-muted)] italic'>—</span>
          ) : boolValue ? (
            'true'
          ) : (
            'false'
          )}
        </span>
      </button>
    )
  }

  if (isNull) {
    return (
      <span
        className='cursor-text text-[var(--text-muted)] italic'
        onDoubleClick={(e) => {
          e.stopPropagation()
          onDoubleClick()
        }}
      >
        —
      </span>
    )
  }

  if (column.type === 'json') {
    const jsonStr = JSON.stringify(value)
    return (
      <button
        type='button'
        className='block max-w-[300px] cursor-pointer select-none truncate rounded-[4px] border border-[var(--border-1)] px-[6px] py-[2px] text-left font-mono text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--text-muted)] hover:text-[var(--text-primary)]'
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onCellClick(column.name, value, 'json')
        }}
        onDoubleClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDoubleClick()
        }}
        title='Click to view, double-click to edit'
      >
        {jsonStr}
      </button>
    )
  }

  if (column.type === 'number') {
    return (
      <span
        className='cursor-text font-mono text-[12px] text-[var(--text-secondary)]'
        onDoubleClick={(e) => {
          e.stopPropagation()
          onDoubleClick()
        }}
      >
        {String(value)}
      </span>
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
      return (
        <span
          className='cursor-text text-[12px] text-[var(--text-secondary)]'
          onDoubleClick={(e) => {
            e.stopPropagation()
            onDoubleClick()
          }}
        >
          {formatted}
        </span>
      )
    } catch {
      return (
        <span
          className='cursor-text text-[var(--text-primary)]'
          onDoubleClick={(e) => {
            e.stopPropagation()
            onDoubleClick()
          }}
        >
          {String(value)}
        </span>
      )
    }
  }

  const strValue = String(value)
  if (strValue.length > STRING_TRUNCATE_LENGTH) {
    return (
      <button
        type='button'
        className='block max-w-[300px] cursor-pointer select-none truncate text-left text-[var(--text-primary)] underline decoration-[var(--border-1)] decoration-dotted underline-offset-2 transition-colors hover:decoration-[var(--text-muted)]'
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onCellClick(column.name, value, 'text')
        }}
        onDoubleClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDoubleClick()
        }}
        title='Click to view, double-click to edit'
      >
        {strValue}
      </button>
    )
  }

  return (
    <span
      className='cursor-text text-[var(--text-primary)]'
      onDoubleClick={(e) => {
        e.stopPropagation()
        onDoubleClick()
      }}
    >
      {strValue}
    </span>
  )
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
      const cleaned = cleanCellValue(draft, column)
      onSave(cleaned)
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
      className='h-full w-full rounded-[2px] border-none bg-transparent px-[4px] py-[2px] text-[13px] text-[var(--text-primary)] outline-none ring-1 ring-[var(--accent)] ring-inset'
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
          <td className='border-[var(--border)] border-r border-b py-[10px] pr-[12px] pl-[24px] align-middle'>
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
            const variation = ((rowIndex + colIndex) % 3) * 20
            const width = baseWidth + variation

            return (
              <td
                key={col.name}
                className='border-[var(--border)] border-r border-b px-[24px] py-[10px] align-middle'
              >
                <Skeleton className='h-[16px]' style={{ width: `${width}px` }} />
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}

const PLACEHOLDER_ROW_COUNT = 50

function PlaceholderRows({
  columns,
  editingEmptyCell,
  onDoubleClick,
  onSave,
  onCancel,
}: {
  columns: ColumnDefinition[]
  editingEmptyCell: { rowIndex: number; columnName: string } | null
  onDoubleClick: (rowIndex: number, columnName: string) => void
  onSave: (columnName: string, value: unknown) => void
  onCancel: () => void
}) {
  return (
    <>
      {Array.from({ length: PLACEHOLDER_ROW_COUNT }).map((_, i) => (
        <tr key={`placeholder-${i}`}>
          <td className='border-[var(--border)] border-r border-b py-[10px] pr-[12px] pl-[24px] align-middle' />
          {columns.map((col) => {
            const isEditing =
              editingEmptyCell?.rowIndex === i && editingEmptyCell.columnName === col.name

            return (
              <td
                key={col.name}
                className='border-[var(--border)] border-r border-b px-[24px] py-[10px] align-middle'
                onDoubleClick={() => onDoubleClick(i, col.name)}
              >
                {isEditing ? (
                  <InlineEditor
                    value={null}
                    column={col}
                    onSave={(value) => onSave(col.name, value)}
                    onCancel={onCancel}
                  />
                ) : (
                  <div className='min-h-[20px]' />
                )}
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}

const COLUMN_TYPE_ICONS: Record<string, React.ElementType> = {
  string: TypeText,
  number: TypeNumber,
  boolean: TypeBoolean,
  date: CalendarIcon,
  json: TypeJson,
}

function ColumnTypeIcon({ type }: { type: string }) {
  const Icon = COLUMN_TYPE_ICONS[type] ?? TypeText
  return <Icon className='h-[14px] w-[14px] shrink-0 text-[var(--text-muted)]' />
}
