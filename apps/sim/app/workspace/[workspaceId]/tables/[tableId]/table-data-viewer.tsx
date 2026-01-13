'use client'

import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
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
                      <span
                        className={cn(
                          'block max-w-[300px] truncate text-[13px]',
                          row.data[column.name] === null || row.data[column.name] === undefined
                            ? 'text-[var(--text-muted)] italic'
                            : column.type === 'boolean'
                              ? row.data[column.name]
                                ? 'text-green-500'
                                : 'text-[var(--text-tertiary)]'
                              : column.type === 'number'
                                ? 'font-mono text-[var(--brand-secondary)]'
                                : 'text-[var(--text-primary)]'
                        )}
                      >
                        {formatValue(row.data[column.name], column.type)}
                      </span>
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
    </div>
  )
}
