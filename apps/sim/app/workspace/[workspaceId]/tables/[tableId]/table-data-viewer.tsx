'use client'

import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQuery } from '@tanstack/react-query'
import { Copy, Edit, Info, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import {
  Badge,
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from '@/components/emcn'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/core/utils/cn'
import type { ColumnDefinition, TableSchema } from '@/lib/table'
import { AddRowModal } from './components/add-row-modal'
import { DeleteRowModal } from './components/delete-row-modal'
import { EditRowModal } from './components/edit-row-modal'
import { FilterBuilder, type QueryOptions } from './components/filter-builder'
import { TableActionBar } from './components/table-action-bar'

const logger = createLogger('TableDataViewer')

/** Number of rows to fetch per page */
const ROWS_PER_PAGE = 100

/** Maximum length for string display before truncation */
const STRING_TRUNCATE_LENGTH = 50

/**
 * Represents row data stored in a table.
 */
interface TableRowData {
  /** Unique identifier for the row */
  id: string
  /** Row field values keyed by column name */
  data: Record<string, unknown>
  /** ISO timestamp when the row was created */
  createdAt: string
  /** ISO timestamp when the row was last updated */
  updatedAt: string
}

/**
 * Represents table metadata.
 */
interface TableData {
  /** Unique identifier for the table */
  id: string
  /** Table name */
  name: string
  /** Optional description */
  description?: string
  /** Schema defining columns */
  schema: TableSchema
  /** Current number of rows */
  rowCount: number
  /** Maximum allowed rows */
  maxRows: number
  /** ISO timestamp when created */
  createdAt: string
  /** ISO timestamp when last updated */
  updatedAt: string
}

/**
 * Data for the cell viewer modal.
 */
interface CellViewerData {
  /** Name of the column being viewed */
  columnName: string
  /** Value being displayed */
  value: unknown
  /** Display type for formatting */
  type: 'json' | 'text' | 'date'
}

/**
 * State for the right-click context menu.
 */
interface ContextMenuState {
  /** Whether the menu is visible */
  isOpen: boolean
  /** Screen position of the menu */
  position: { x: number; y: number }
  /** Row the menu was opened on */
  row: TableRowData | null
}

/**
 * Gets the badge variant for a column type.
 *
 * @param type - The column type
 * @returns Badge variant name
 */
function getTypeBadgeVariant(
  type: string
): 'green' | 'blue' | 'purple' | 'orange' | 'teal' | 'gray' {
  switch (type) {
    case 'string':
      return 'green'
    case 'number':
      return 'blue'
    case 'boolean':
      return 'purple'
    case 'json':
      return 'orange'
    case 'date':
      return 'teal'
    default:
      return 'gray'
  }
}

/**
 * Main component for viewing and managing table data.
 *
 * @remarks
 * Provides functionality for:
 * - Viewing rows with pagination
 * - Filtering and sorting
 * - Adding, editing, and deleting rows
 * - Viewing cell details for long/complex values
 *
 * @example
 * ```tsx
 * <TableDataViewer />
 * ```
 */
export function TableDataViewer() {
  const params = useParams()
  const router = useRouter()

  const workspaceId = params.workspaceId as string
  const tableId = params.tableId as string

  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [queryOptions, setQueryOptions] = useState<QueryOptions>({
    filter: null,
    sort: null,
  })
  const [currentPage, setCurrentPage] = useState(0)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingRow, setEditingRow] = useState<TableRowData | null>(null)
  const [deletingRows, setDeletingRows] = useState<string[]>([])
  const [cellViewer, setCellViewer] = useState<CellViewerData | null>(null)
  const [showSchemaModal, setShowSchemaModal] = useState(false)
  const [copied, setCopied] = useState(false)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    row: null,
  })
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Fetch table metadata
  const { data: tableData, isLoading: isLoadingTable } = useQuery({
    queryKey: ['table', tableId],
    queryFn: async () => {
      const res = await fetch(`/api/table/${tableId}?workspaceId=${workspaceId}`)
      if (!res.ok) throw new Error('Failed to fetch table')
      const json: { data?: { table: TableData }; table?: TableData } = await res.json()
      const data = json.data || json
      return (data as { table: TableData }).table
    },
  })

  // Fetch table rows with filter and sort
  const {
    data: rowsData,
    isLoading: isLoadingRows,
    refetch: refetchRows,
  } = useQuery({
    queryKey: ['table-rows', tableId, queryOptions, currentPage],
    queryFn: async () => {
      const searchParams = new URLSearchParams({
        workspaceId,
        limit: String(ROWS_PER_PAGE),
        offset: String(currentPage * ROWS_PER_PAGE),
      })

      if (queryOptions.filter) {
        searchParams.set('filter', JSON.stringify(queryOptions.filter))
      }

      if (queryOptions.sort) {
        // Convert from {column, direction} to {column: direction} format expected by API
        const sortParam = { [queryOptions.sort.column]: queryOptions.sort.direction }
        searchParams.set('sort', JSON.stringify(sortParam))
      }

      const res = await fetch(`/api/table/${tableId}/rows?${searchParams}`)
      if (!res.ok) throw new Error('Failed to fetch rows')
      const json: {
        data?: { rows: TableRowData[]; totalCount: number }
        rows?: TableRowData[]
        totalCount?: number
      } = await res.json()
      return json.data || json
    },
    enabled: !!tableData,
  })

  const columns = tableData?.schema?.columns || []
  const rows = (rowsData?.rows || []) as TableRowData[]
  const totalCount = rowsData?.totalCount || 0
  const totalPages = Math.ceil(totalCount / ROWS_PER_PAGE)

  /**
   * Applies new query options and resets pagination.
   */
  const handleApplyQueryOptions = useCallback((options: QueryOptions) => {
    setQueryOptions(options)
    setCurrentPage(0)
  }, [])

  /**
   * Toggles selection of all visible rows.
   */
  const handleSelectAll = useCallback(() => {
    if (selectedRows.size === rows.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(rows.map((r) => r.id)))
    }
  }, [rows, selectedRows.size])

  /**
   * Toggles selection of a single row.
   */
  const handleSelectRow = useCallback((rowId: string) => {
    setSelectedRows((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(rowId)) {
        newSet.delete(rowId)
      } else {
        newSet.add(rowId)
      }
      return newSet
    })
  }, [])

  /**
   * Refreshes the rows data.
   */
  const handleRefresh = useCallback(() => {
    refetchRows()
  }, [refetchRows])

  /**
   * Opens the delete modal for selected rows.
   */
  const handleDeleteSelected = useCallback(() => {
    setDeletingRows(Array.from(selectedRows))
  }, [selectedRows])

  /**
   * Opens the context menu for a row.
   */
  const handleRowContextMenu = useCallback((e: React.MouseEvent, row: TableRowData) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      row,
    })
  }, [])

  /**
   * Closes the context menu.
   */
  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }))
  }, [])

  /**
   * Handles edit action from context menu.
   */
  const handleContextMenuEdit = useCallback(() => {
    if (contextMenu.row) {
      setEditingRow(contextMenu.row)
    }
    closeContextMenu()
  }, [contextMenu.row, closeContextMenu])

  /**
   * Handles delete action from context menu.
   */
  const handleContextMenuDelete = useCallback(() => {
    if (contextMenu.row) {
      setDeletingRows([contextMenu.row.id])
    }
    closeContextMenu()
  }, [contextMenu.row, closeContextMenu])

  /**
   * Copies the current cell value to clipboard.
   */
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

  /**
   * Opens the cell viewer modal.
   */
  const handleCellClick = useCallback(
    (e: React.MouseEvent, columnName: string, value: unknown, type: 'json' | 'text' | 'date') => {
      e.preventDefault()
      e.stopPropagation()
      setCellViewer({ columnName, value, type })
    },
    []
  )

  /**
   * Renders a cell value with appropriate formatting.
   */
  const renderCellValue = (value: unknown, column: ColumnDefinition) => {
    const isNull = value === null || value === undefined

    if (isNull) {
      return <span className='text-[var(--text-muted)] italic'>—</span>
    }

    if (column.type === 'json') {
      const jsonStr = JSON.stringify(value)
      return (
        <button
          type='button'
          className='block max-w-[300px] cursor-pointer select-none truncate rounded-[4px] border border-[var(--border-1)] px-[6px] py-[2px] text-left font-mono text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--text-muted)] hover:text-[var(--text-primary)]'
          onClick={(e) => handleCellClick(e, column.name, value, 'json')}
          title='Click to view full JSON'
        >
          {jsonStr}
        </button>
      )
    }

    if (column.type === 'boolean') {
      const boolValue = Boolean(value)
      return (
        <span className={boolValue ? 'text-green-500' : 'text-[var(--text-tertiary)]'}>
          {boolValue ? 'true' : 'false'}
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
        return (
          <button
            type='button'
            className='cursor-pointer select-none text-left text-[12px] text-[var(--text-secondary)] underline decoration-[var(--border-1)] decoration-dotted underline-offset-2 transition-colors hover:text-[var(--text-primary)] hover:decoration-[var(--text-muted)]'
            onClick={(e) => handleCellClick(e, column.name, value, 'date')}
            title='Click to view ISO format'
          >
            {formatted}
          </button>
        )
      } catch {
        return <span className='text-[var(--text-primary)]'>{String(value)}</span>
      }
    }

    // Handle long strings
    const strValue = String(value)
    if (strValue.length > STRING_TRUNCATE_LENGTH) {
      return (
        <button
          type='button'
          className='block max-w-[300px] cursor-pointer select-none truncate text-left text-[var(--text-primary)] underline decoration-[var(--border-1)] decoration-dotted underline-offset-2 transition-colors hover:decoration-[var(--text-muted)]'
          onClick={(e) => handleCellClick(e, column.name, value, 'text')}
          title='Click to view full text'
        >
          {strValue}
        </button>
      )
    }

    return <span className='text-[var(--text-primary)]'>{strValue}</span>
  }

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
      {/* Header */}
      <div className='flex h-[48px] shrink-0 items-center justify-between border-[var(--border)] border-b px-[16px]'>
        <div className='flex items-center gap-[8px]'>
          <button
            onClick={() => router.push(`/workspace/${workspaceId}/tables`)}
            className='text-[13px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]'
          >
            Tables
          </button>
          <span className='text-[var(--text-muted)]'>/</span>
          <span className='font-medium text-[13px] text-[var(--text-primary)]'>
            {tableData.name}
          </span>
          {isLoadingRows ? (
            <Skeleton className='h-[18px] w-[60px] rounded-full' />
          ) : (
            <Badge variant='gray-secondary' size='sm'>
              {totalCount} {totalCount === 1 ? 'row' : 'rows'}
            </Badge>
          )}
        </div>

        <div className='flex items-center gap-[8px]'>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button variant='ghost' size='sm' onClick={() => setShowSchemaModal(true)}>
                <Info className='h-[14px] w-[14px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>View Schema</Tooltip.Content>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button variant='ghost' size='sm' onClick={handleRefresh}>
                <RefreshCw className='h-[14px] w-[14px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Refresh</Tooltip.Content>
          </Tooltip.Root>
        </div>
      </div>

      {/* Filter Bar */}
      <div className='flex shrink-0 flex-col gap-[8px] border-[var(--border)] border-b px-[16px] py-[10px]'>
        <FilterBuilder
          columns={columns}
          onApply={handleApplyQueryOptions}
          onAddRow={() => setShowAddModal(true)}
        />
        {selectedRows.size > 0 && (
          <span className='text-[11px] text-[var(--text-tertiary)]'>
            {selectedRows.size} selected
          </span>
        )}
      </div>

      {/* Action Bar */}
      {selectedRows.size > 0 && (
        <TableActionBar
          selectedCount={selectedRows.size}
          onDelete={handleDeleteSelected}
          onClearSelection={() => setSelectedRows(new Set())}
        />
      )}

      {/* Table */}
      <div className='flex-1 overflow-auto'>
        <Table>
          <TableHeader className='sticky top-0 z-10 bg-[var(--surface-3)]'>
            <TableRow>
              <TableHead className='w-[40px]'>
                <Checkbox
                  size='sm'
                  checked={selectedRows.size === rows.length && rows.length > 0}
                  onCheckedChange={handleSelectAll}
                />
              </TableHead>
              {columns.map((column) => (
                <TableHead key={column.name}>
                  <div className='flex items-center gap-[6px]'>
                    <span className='text-[12px]'>{column.name}</span>
                    <Badge variant='outline' size='sm'>
                      {column.type}
                    </Badge>
                    {column.required && (
                      <span className='text-[10px] text-[var(--text-error)]'>*</span>
                    )}
                  </div>
                </TableHead>
              ))}
              <TableHead className='w-[80px]'>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoadingRows ? (
              <LoadingRows columns={columns} />
            ) : rows.length === 0 ? (
              <EmptyRows
                columnCount={columns.length}
                hasFilter={!!queryOptions.filter}
                onAddRow={() => setShowAddModal(true)}
              />
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    'group hover:bg-[var(--surface-4)]',
                    selectedRows.has(row.id) && 'bg-[var(--surface-5)]'
                  )}
                  onContextMenu={(e) => handleRowContextMenu(e, row)}
                >
                  <TableCell>
                    <Checkbox
                      size='sm'
                      checked={selectedRows.has(row.id)}
                      onCheckedChange={() => handleSelectRow(row.id)}
                    />
                  </TableCell>
                  {columns.map((column) => (
                    <TableCell key={column.name}>
                      <div className='max-w-[300px] truncate text-[13px]'>
                        {renderCellValue(row.data[column.name], column)}
                      </div>
                    </TableCell>
                  ))}
                  <TableCell>
                    <div className='flex items-center gap-[2px] opacity-0 transition-opacity group-hover:opacity-100'>
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <Button variant='ghost' size='sm' onClick={() => setEditingRow(row)}>
                            <Edit className='h-[12px] w-[12px]' />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content>Edit</Tooltip.Content>
                      </Tooltip.Root>
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() => setDeletingRows([row.id])}
                            className='text-[var(--text-tertiary)] hover:text-[var(--text-error)]'
                          >
                            <Trash2 className='h-[12px] w-[12px]' />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content>Delete</Tooltip.Content>
                      </Tooltip.Root>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className='flex h-[40px] shrink-0 items-center justify-between border-[var(--border)] border-t px-[16px]'>
          <span className='text-[11px] text-[var(--text-tertiary)]'>
            Page {currentPage + 1} of {totalPages} ({totalCount} rows)
          </span>
          <div className='flex items-center gap-[4px]'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
            >
              Previous
            </Button>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage === totalPages - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Modals */}
      <AddRowModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        table={tableData}
        onSuccess={() => {
          refetchRows()
          setShowAddModal(false)
        }}
      />

      {editingRow && (
        <EditRowModal
          isOpen={true}
          onClose={() => setEditingRow(null)}
          table={tableData}
          row={editingRow}
          onSuccess={() => {
            refetchRows()
            setEditingRow(null)
          }}
        />
      )}

      {deletingRows.length > 0 && (
        <DeleteRowModal
          isOpen={true}
          onClose={() => setDeletingRows([])}
          tableId={tableId}
          rowIds={deletingRows}
          onSuccess={() => {
            refetchRows()
            setDeletingRows([])
            setSelectedRows(new Set())
          }}
        />
      )}

      {/* Schema Viewer Modal */}
      <SchemaViewerModal
        isOpen={showSchemaModal}
        onClose={() => setShowSchemaModal(false)}
        columns={columns}
      />

      {/* Cell Viewer Modal */}
      <CellViewerModal
        cellViewer={cellViewer}
        onClose={() => setCellViewer(null)}
        onCopy={handleCopyCellValue}
        copied={copied}
      />

      {/* Row Context Menu */}
      <Popover
        open={contextMenu.isOpen}
        onOpenChange={(open) => !open && closeContextMenu()}
        variant='secondary'
        size='sm'
        colorScheme='inverted'
      >
        <PopoverAnchor
          style={{
            position: 'fixed',
            left: `${contextMenu.position.x}px`,
            top: `${contextMenu.position.y}px`,
            width: '1px',
            height: '1px',
          }}
        />
        <PopoverContent
          ref={contextMenuRef}
          align='start'
          side='bottom'
          sideOffset={4}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <PopoverItem onClick={handleContextMenuEdit}>
            <Edit className='mr-[8px] h-[12px] w-[12px]' />
            Edit row
          </PopoverItem>
          <PopoverDivider />
          <PopoverItem onClick={handleContextMenuDelete} className='text-[var(--text-error)]'>
            <Trash2 className='mr-[8px] h-[12px] w-[12px]' />
            Delete row
          </PopoverItem>
        </PopoverContent>
      </Popover>
    </div>
  )
}

/**
 * Loading skeleton for table rows.
 */
function LoadingRows({ columns }: { columns: ColumnDefinition[] }) {
  return (
    <>
      {Array.from({ length: 25 }).map((_, rowIndex) => (
        <TableRow key={rowIndex}>
          <TableCell>
            <Skeleton className='h-[14px] w-[14px]' />
          </TableCell>
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
              <TableCell key={col.name}>
                <Skeleton className='h-[16px]' style={{ width: `${width}px` }} />
              </TableCell>
            )
          })}
          <TableCell>
            <div className='flex gap-[4px]'>
              <Skeleton className='h-[24px] w-[24px]' />
              <Skeleton className='h-[24px] w-[24px]' />
            </div>
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}

/**
 * Empty state for table rows.
 */
function EmptyRows({
  columnCount,
  hasFilter,
  onAddRow,
}: {
  columnCount: number
  hasFilter: boolean
  onAddRow: () => void
}) {
  return (
    <TableRow>
      <TableCell colSpan={columnCount + 2} className='h-[160px] text-center'>
        <div className='flex flex-col items-center gap-[12px]'>
          <span className='text-[13px] text-[var(--text-tertiary)]'>
            {hasFilter ? 'No rows match your filter' : 'No data'}
          </span>
          {!hasFilter && (
            <Button variant='default' size='sm' onClick={onAddRow}>
              <Plus className='mr-[4px] h-[12px] w-[12px]' />
              Add first row
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

/**
 * Modal for viewing table schema.
 */
function SchemaViewerModal({
  isOpen,
  onClose,
  columns,
}: {
  isOpen: boolean
  onClose: () => void
  columns: ColumnDefinition[]
}) {
  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent className='w-[500px] duration-100'>
        <div className='flex items-center justify-between gap-[8px] px-[16px] py-[10px]'>
          <div className='flex min-w-0 items-center gap-[8px]'>
            <Info className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
            <span className='font-medium text-[14px] text-[var(--text-primary)]'>Table Schema</span>
            <Badge variant='gray' size='sm'>
              {columns.length} columns
            </Badge>
          </div>
          <Button variant='ghost' size='sm' onClick={onClose}>
            <X className='h-[14px] w-[14px]' />
          </Button>
        </div>
        <ModalBody className='p-0'>
          <div className='max-h-[400px] overflow-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-[180px]'>Column</TableHead>
                  <TableHead className='w-[100px]'>Type</TableHead>
                  <TableHead>Constraints</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {columns.map((column) => (
                  <TableRow key={column.name}>
                    <TableCell className='font-mono text-[12px] text-[var(--text-primary)]'>
                      {column.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getTypeBadgeVariant(column.type)} size='sm'>
                        {column.type}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-[12px]'>
                      <div className='flex gap-[6px]'>
                        {column.required && (
                          <Badge variant='red' size='sm'>
                            required
                          </Badge>
                        )}
                        {column.unique && (
                          <Badge variant='purple' size='sm'>
                            unique
                          </Badge>
                        )}
                        {!column.required && !column.unique && (
                          <span className='text-[var(--text-muted)]'>—</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

/**
 * Modal for viewing cell details.
 */
function CellViewerModal({
  cellViewer,
  onClose,
  onCopy,
  copied,
}: {
  cellViewer: CellViewerData | null
  onClose: () => void
  onCopy: () => void
  copied: boolean
}) {
  if (!cellViewer) return null

  return (
    <Modal open={!!cellViewer} onOpenChange={(open) => !open && onClose()}>
      <ModalContent className='w-[640px] duration-100'>
        <div className='flex items-center justify-between gap-[8px] px-[16px] py-[10px]'>
          <div className='flex min-w-0 items-center gap-[8px]'>
            <span className='truncate font-medium text-[14px] text-[var(--text-primary)]'>
              {cellViewer.columnName}
            </span>
            <Badge
              variant={
                cellViewer.type === 'json' ? 'blue' : cellViewer.type === 'date' ? 'purple' : 'gray'
              }
              size='sm'
            >
              {cellViewer.type === 'json' ? 'JSON' : cellViewer.type === 'date' ? 'Date' : 'Text'}
            </Badge>
          </div>
          <div className='flex shrink-0 items-center gap-[8px]'>
            <Button variant={copied ? 'tertiary' : 'default'} size='sm' onClick={onCopy}>
              <Copy className='mr-[4px] h-[12px] w-[12px]' />
              {copied ? 'Copied!' : 'Copy'}
            </Button>
            <Button variant='ghost' size='sm' onClick={onClose}>
              <X className='h-[14px] w-[14px]' />
            </Button>
          </div>
        </div>
        <ModalBody className='p-0'>
          {cellViewer.type === 'json' ? (
            <pre className='m-[16px] max-h-[450px] overflow-auto rounded-[6px] border border-[var(--border)] bg-[var(--surface-4)] p-[16px] font-mono text-[12px] text-[var(--text-primary)] leading-[1.6]'>
              {JSON.stringify(cellViewer.value, null, 2)}
            </pre>
          ) : cellViewer.type === 'date' ? (
            <div className='m-[16px] space-y-[12px]'>
              <div className='rounded-[6px] border border-[var(--border)] bg-[var(--surface-4)] p-[16px]'>
                <div className='mb-[6px] font-medium text-[11px] text-[var(--text-tertiary)] uppercase tracking-wide'>
                  Formatted
                </div>
                <div className='text-[14px] text-[var(--text-primary)]'>
                  {new Date(String(cellViewer.value)).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZoneName: 'short',
                  })}
                </div>
              </div>
              <div className='rounded-[6px] border border-[var(--border)] bg-[var(--surface-4)] p-[16px]'>
                <div className='mb-[6px] font-medium text-[11px] text-[var(--text-tertiary)] uppercase tracking-wide'>
                  ISO Format
                </div>
                <div className='font-mono text-[13px] text-[var(--text-secondary)]'>
                  {String(cellViewer.value)}
                </div>
              </div>
            </div>
          ) : (
            <div className='m-[16px] max-h-[450px] overflow-auto whitespace-pre-wrap break-words rounded-[6px] border border-[var(--border)] bg-[var(--surface-4)] p-[16px] text-[13px] text-[var(--text-primary)] leading-[1.7]'>
              {String(cellViewer.value)}
            </div>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
