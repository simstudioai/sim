'use client'

import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  Columns,
  Copy,
  Edit,
  Filter,
  HelpCircle,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  Popover,
  PopoverContent,
  PopoverTrigger,
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
import type { TableSchema } from '@/lib/table'
import { AddRowModal } from './components/add-row-modal'
import { DeleteRowModal } from './components/delete-row-modal'
import { EditRowModal } from './components/edit-row-modal'
import { TableActionBar } from './components/table-action-bar'

const logger = createLogger('TableDataViewer')

const ROWS_PER_PAGE = 100

interface TableRowData {
  id: string
  data: Record<string, any>
  createdAt: string
  updatedAt: string
}

interface TableData {
  id: string
  name: string
  description?: string
  schema: TableSchema
  rowCount: number
  maxRows: number
  createdAt: string
  updatedAt: string
}

interface CellViewerData {
  columnName: string
  value: any
  type: 'json' | 'text'
}

const STRING_TRUNCATE_LENGTH = 50

export function TableDataViewer() {
  const params = useParams()
  const router = useRouter()

  const workspaceId = params.workspaceId as string
  const tableId = params.tableId as string

  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [filterInput, setFilterInput] = useState('')
  const [appliedFilter, setAppliedFilter] = useState<Record<string, any> | null>(null)
  const [filterError, setFilterError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingRow, setEditingRow] = useState<TableRowData | null>(null)
  const [deletingRows, setDeletingRows] = useState<string[]>([])
  const [cellViewer, setCellViewer] = useState<CellViewerData | null>(null)
  const [showSchemaModal, setShowSchemaModal] = useState(false)
  const [copied, setCopied] = useState(false)

  // Fetch table metadata
  const { data: tableData, isLoading: isLoadingTable } = useQuery({
    queryKey: ['table', tableId],
    queryFn: async () => {
      const res = await fetch(`/api/table/${tableId}?workspaceId=${workspaceId}`)
      if (!res.ok) throw new Error('Failed to fetch table')
      const json = await res.json()
      return json.table as TableData
    },
  })

  // Fetch table rows with filter
  const {
    data: rowsData,
    isLoading: isLoadingRows,
    refetch: refetchRows,
  } = useQuery({
    queryKey: ['table-rows', tableId, currentPage, appliedFilter],
    queryFn: async () => {
      const queryParams = new URLSearchParams({
        workspaceId,
        limit: String(ROWS_PER_PAGE),
        offset: String(currentPage * ROWS_PER_PAGE),
      })

      if (appliedFilter) {
        queryParams.set('filter', JSON.stringify(appliedFilter))
      }

      const res = await fetch(`/api/table/${tableId}/rows?${queryParams}`)
      if (!res.ok) throw new Error('Failed to fetch rows')
      return res.json()
    },
    enabled: !!tableData,
  })

  const columns = tableData?.schema?.columns || []
  const rows = (rowsData?.rows || []) as TableRowData[]
  const totalCount = rowsData?.totalCount || 0
  const totalPages = Math.ceil(totalCount / ROWS_PER_PAGE)

  const handleApplyFilter = useCallback(() => {
    setFilterError(null)

    if (!filterInput.trim()) {
      setAppliedFilter(null)
      setCurrentPage(0)
      return
    }

    try {
      const parsed = JSON.parse(filterInput)
      setAppliedFilter(parsed)
      setCurrentPage(0)
    } catch (err) {
      setFilterError('Invalid JSON. Use format: {"column": {"$eq": "value"}}')
    }
  }, [filterInput])

  const handleClearFilter = useCallback(() => {
    setFilterInput('')
    setAppliedFilter(null)
    setFilterError(null)
    setCurrentPage(0)
  }, [])

  const handleSelectAll = useCallback(() => {
    if (selectedRows.size === rows.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(rows.map((r) => r.id)))
    }
  }, [rows, selectedRows.size])

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

  const handleRefresh = useCallback(() => {
    refetchRows()
  }, [refetchRows])

  const handleDeleteSelected = useCallback(() => {
    setDeletingRows(Array.from(selectedRows))
  }, [selectedRows])

  const handleCopyCellValue = useCallback(async () => {
    if (cellViewer) {
      const text =
        cellViewer.type === 'json'
          ? JSON.stringify(cellViewer.value, null, 2)
          : String(cellViewer.value)
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [cellViewer])

  const formatValue = (value: any, type: string): string => {
    if (value === null || value === undefined) return '—'

    switch (type) {
      case 'boolean':
        return value ? 'true' : 'false'
      case 'date':
        try {
          return new Date(value).toLocaleDateString()
        } catch {
          return String(value)
        }
      case 'json':
        return JSON.stringify(value)
      case 'number':
        return String(value)
      default:
        return String(value)
    }
  }

  const handleCellClick = useCallback(
    (e: React.MouseEvent, columnName: string, value: any, type: 'json' | 'text') => {
      e.preventDefault()
      e.stopPropagation()
      setCellViewer({ columnName, value, type })
    },
    []
  )

  const renderCellValue = (value: any, column: { name: string; type: string }) => {
    const isNull = value === null || value === undefined

    if (isNull) {
      return <span className='text-[var(--text-muted)] italic'>—</span>
    }

    if (column.type === 'json') {
      const jsonStr = JSON.stringify(value)
      return (
        <button
          type='button'
          className='block max-w-[300px] cursor-pointer select-none truncate rounded-[4px] border border-[var(--border-1)] px-[6px] py-[2px] text-left font-mono text-[11px] text-[var(--brand-secondary)] transition-colors hover:border-[var(--text-muted)] hover:text-[var(--text-primary)]'
          onClick={(e) => handleCellClick(e, column.name, value, 'json')}
          title='Click to view full JSON'
        >
          {jsonStr}
        </button>
      )
    }

    if (column.type === 'boolean') {
      return (
        <span className={value ? 'text-green-500' : 'text-[var(--text-tertiary)]'}>
          {value ? 'true' : 'false'}
        </span>
      )
    }

    if (column.type === 'number') {
      return <span className='font-mono text-[var(--brand-secondary)]'>{String(value)}</span>
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
          <Badge variant='gray-secondary' size='sm'>
            {totalCount} {totalCount === 1 ? 'row' : 'rows'}
          </Badge>
        </div>

        <div className='flex items-center gap-[8px]'>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button variant='ghost' size='sm' onClick={() => setShowSchemaModal(true)}>
                <Columns className='h-[14px] w-[14px]' />
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

          <Button variant='default' size='sm' onClick={() => setShowAddModal(true)}>
            <Plus className='mr-[4px] h-[12px] w-[12px]' />
            Add Row
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className='flex shrink-0 flex-col gap-[8px] border-[var(--border)] border-b px-[16px] py-[10px]'>
        <div className='flex items-center gap-[8px]'>
          <Filter className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
          <Input
            value={filterInput}
            onChange={(e) => setFilterInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleApplyFilter()
              }
            }}
            placeholder='{"column": {"$eq": "value"}}'
            className={cn(
              'h-[32px] flex-1 font-mono text-[11px]',
              filterError && 'border-[var(--text-error)]'
            )}
          />
          <Button variant='default' size='sm' onClick={handleApplyFilter}>
            Apply
          </Button>
          {appliedFilter && (
            <Button variant='ghost' size='sm' onClick={handleClearFilter}>
              <X className='h-[12px] w-[12px]' />
            </Button>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant='ghost' size='sm'>
                <HelpCircle className='h-[14px] w-[14px]' />
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-[360px] p-[12px]' align='end'>
              <div className='flex flex-col gap-[12px]'>
                <div>
                  <h4 className='font-medium text-[12px] text-[var(--text-primary)]'>
                    Filter Operators
                  </h4>
                  <p className='text-[11px] text-[var(--text-tertiary)]'>
                    Use MongoDB-style operators to filter rows
                  </p>
                </div>
                <div className='flex flex-col gap-[6px] font-mono text-[10px]'>
                  <div className='flex items-start gap-[8px]'>
                    <code className='rounded bg-[var(--surface-5)] px-[4px] py-[2px] text-[var(--brand-secondary)]'>
                      $eq
                    </code>
                    <span className='text-[var(--text-secondary)]'>
                      Equals: {`{"status": "active"}`}
                    </span>
                  </div>
                  <div className='flex items-start gap-[8px]'>
                    <code className='rounded bg-[var(--surface-5)] px-[4px] py-[2px] text-[var(--brand-secondary)]'>
                      $ne
                    </code>
                    <span className='text-[var(--text-secondary)]'>
                      Not equals: {`{"status": {"$ne": "deleted"}}`}
                    </span>
                  </div>
                  <div className='flex items-start gap-[8px]'>
                    <code className='rounded bg-[var(--surface-5)] px-[4px] py-[2px] text-[var(--brand-secondary)]'>
                      $gt
                    </code>
                    <span className='text-[var(--text-secondary)]'>
                      Greater than: {`{"age": {"$gt": 18}}`}
                    </span>
                  </div>
                  <div className='flex items-start gap-[8px]'>
                    <code className='rounded bg-[var(--surface-5)] px-[4px] py-[2px] text-[var(--brand-secondary)]'>
                      $gte
                    </code>
                    <span className='text-[var(--text-secondary)]'>
                      Greater or equal: {`{"age": {"$gte": 21}}`}
                    </span>
                  </div>
                  <div className='flex items-start gap-[8px]'>
                    <code className='rounded bg-[var(--surface-5)] px-[4px] py-[2px] text-[var(--brand-secondary)]'>
                      $lt
                    </code>
                    <span className='text-[var(--text-secondary)]'>
                      Less than: {`{"price": {"$lt": 100}}`}
                    </span>
                  </div>
                  <div className='flex items-start gap-[8px]'>
                    <code className='rounded bg-[var(--surface-5)] px-[4px] py-[2px] text-[var(--brand-secondary)]'>
                      $lte
                    </code>
                    <span className='text-[var(--text-secondary)]'>
                      Less or equal: {`{"qty": {"$lte": 10}}`}
                    </span>
                  </div>
                  <div className='flex items-start gap-[8px]'>
                    <code className='rounded bg-[var(--surface-5)] px-[4px] py-[2px] text-[var(--brand-secondary)]'>
                      $in
                    </code>
                    <span className='text-[var(--text-secondary)]'>
                      In array: {`{"status": {"$in": ["a", "b"]}}`}
                    </span>
                  </div>
                  <div className='flex items-start gap-[8px]'>
                    <code className='rounded bg-[var(--surface-5)] px-[4px] py-[2px] text-[var(--brand-secondary)]'>
                      $contains
                    </code>
                    <span className='text-[var(--text-secondary)]'>
                      String contains: {`{"email": {"$contains": "@"}}`}
                    </span>
                  </div>
                </div>
                <div className='border-[var(--border)] border-t pt-[8px]'>
                  <p className='text-[10px] text-[var(--text-tertiary)]'>
                    Combine multiple conditions:{' '}
                    <code className='text-[var(--text-secondary)]'>
                      {`{"age": {"$gte": 18}, "active": true}`}
                    </code>
                  </p>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {filterError && <span className='text-[11px] text-[var(--text-error)]'>{filterError}</span>}
        {appliedFilter && (
          <div className='flex items-center gap-[6px]'>
            <Badge variant='blue' size='sm'>
              Filter active
            </Badge>
            <span className='font-mono text-[10px] text-[var(--text-tertiary)]'>
              {JSON.stringify(appliedFilter)}
            </span>
          </div>
        )}
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
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className='h-[14px] w-[14px]' />
                  </TableCell>
                  {columns.map((col) => (
                    <TableCell key={col.name}>
                      <Skeleton className='h-[16px] w-[80px]' />
                    </TableCell>
                  ))}
                  <TableCell>
                    <Skeleton className='h-[16px] w-[48px]' />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 2} className='h-[160px] text-center'>
                  <div className='flex flex-col items-center gap-[12px]'>
                    <span className='text-[13px] text-[var(--text-tertiary)]'>
                      {appliedFilter ? 'No rows match your filter' : 'No data'}
                    </span>
                    {!appliedFilter && (
                      <Button variant='default' size='sm' onClick={() => setShowAddModal(true)}>
                        <Plus className='mr-[4px] h-[12px] w-[12px]' />
                        Add first row
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    'group hover:bg-[var(--surface-4)]',
                    selectedRows.has(row.id) && 'bg-[var(--surface-5)]'
                  )}
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
            Page {currentPage + 1} of {totalPages}
          </span>
          <div className='flex items-center gap-[4px]'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
            >
              <ChevronLeft className='h-[14px] w-[14px]' />
            </Button>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage === totalPages - 1}
            >
              <ChevronRight className='h-[14px] w-[14px]' />
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
      <Modal open={showSchemaModal} onOpenChange={setShowSchemaModal}>
        <ModalContent className='w-[500px] duration-100'>
          <div className='flex items-center justify-between gap-[8px] px-[16px] py-[10px]'>
            <div className='flex min-w-0 items-center gap-[8px]'>
              <Columns className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
              <span className='font-medium text-[14px] text-[var(--text-primary)]'>
                Table Schema
              </span>
              <Badge variant='gray' size='sm'>
                {columns.length} columns
              </Badge>
            </div>
            <Button variant='ghost' size='sm' onClick={() => setShowSchemaModal(false)}>
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
                        <Badge
                          variant={
                            column.type === 'string'
                              ? 'green'
                              : column.type === 'number'
                                ? 'blue'
                                : column.type === 'boolean'
                                  ? 'purple'
                                  : column.type === 'json'
                                    ? 'orange'
                                    : column.type === 'date'
                                      ? 'teal'
                                      : 'gray'
                          }
                          size='sm'
                        >
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

      {/* Cell Viewer Modal */}
      <Modal open={!!cellViewer} onOpenChange={(open) => !open && setCellViewer(null)}>
        <ModalContent className='w-[640px] duration-100'>
          <div className='flex items-center justify-between gap-[8px] px-[16px] py-[10px]'>
            <div className='flex min-w-0 items-center gap-[8px]'>
              <span className='truncate font-medium text-[14px] text-[var(--text-primary)]'>
                {cellViewer?.columnName}
              </span>
              <Badge variant={cellViewer?.type === 'json' ? 'blue' : 'gray'} size='sm'>
                {cellViewer?.type === 'json' ? 'JSON' : 'Text'}
              </Badge>
            </div>
            <div className='flex shrink-0 items-center gap-[8px]'>
              <Button
                variant={copied ? 'tertiary' : 'default'}
                size='sm'
                onClick={handleCopyCellValue}
              >
                <Copy className='mr-[4px] h-[12px] w-[12px]' />
                {copied ? 'Copied!' : 'Copy'}
              </Button>
              <Button variant='ghost' size='sm' onClick={() => setCellViewer(null)}>
                <X className='h-[14px] w-[14px]' />
              </Button>
            </div>
          </div>
          <ModalBody className='p-0'>
            {cellViewer?.type === 'json' ? (
              <pre className='m-[16px] max-h-[450px] overflow-auto rounded-[6px] border border-[var(--border)] bg-[var(--surface-4)] p-[16px] font-mono text-[12px] text-[var(--text-primary)] leading-[1.6]'>
                {cellViewer ? JSON.stringify(cellViewer.value, null, 2) : ''}
              </pre>
            ) : (
              <div className='m-[16px] max-h-[450px] overflow-auto whitespace-pre-wrap break-words rounded-[6px] border border-[var(--border)] bg-[var(--surface-4)] p-[16px] text-[13px] text-[var(--text-primary)] leading-[1.7]'>
                {cellViewer ? String(cellViewer.value) : ''}
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  )
}
