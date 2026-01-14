'use client'

/**
 * Main table data viewer component.
 *
 * @module tables/[tableId]/table-data-viewer/table-data-viewer
 */

import { useCallback, useState } from 'react'
import { Edit, Trash2 } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import {
  Badge,
  Button,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  AddRowModal,
  DeleteRowModal,
  EditRowModal,
  FilterBuilder,
  type QueryOptions,
  TableActionBar,
} from '../components'
import {
  CellRenderer,
  CellViewerModal,
  EmptyRows,
  LoadingRows,
  Pagination,
  RowContextMenu,
  SchemaViewerModal,
  TableHeaderBar,
} from './components'
import { useContextMenu, useRowSelection, useTableData } from './hooks'
import type { CellViewerData, TableRowData } from './types'

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

  // Query state
  const [queryOptions, setQueryOptions] = useState<QueryOptions>({
    filter: null,
    sort: null,
  })
  const [currentPage, setCurrentPage] = useState(0)

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingRow, setEditingRow] = useState<TableRowData | null>(null)
  const [deletingRows, setDeletingRows] = useState<string[]>([])
  const [showSchemaModal, setShowSchemaModal] = useState(false)

  // Cell viewer state
  const [cellViewer, setCellViewer] = useState<CellViewerData | null>(null)
  const [copied, setCopied] = useState(false)

  // Fetch table data
  const { tableData, isLoadingTable, rows, totalCount, totalPages, isLoadingRows, refetchRows } =
    useTableData({
      workspaceId,
      tableId,
      queryOptions,
      currentPage,
    })

  // Row selection
  const { selectedRows, handleSelectAll, handleSelectRow, clearSelection } = useRowSelection(rows)

  // Context menu
  const { contextMenu, handleRowContextMenu, closeContextMenu } = useContextMenu()

  const columns = tableData?.schema?.columns || []

  /**
   * Applies new query options and resets pagination.
   */
  const handleApplyQueryOptions = useCallback((options: QueryOptions) => {
    setQueryOptions(options)
    setCurrentPage(0)
  }, [])

  /**
   * Opens the delete modal for selected rows.
   */
  const handleDeleteSelected = useCallback(() => {
    setDeletingRows(Array.from(selectedRows))
  }, [selectedRows])

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
    (columnName: string, value: unknown, type: CellViewerData['type']) => {
      setCellViewer({ columnName, value, type })
    },
    []
  )

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
      <TableHeaderBar
        tableName={tableData.name}
        totalCount={totalCount}
        isLoading={isLoadingRows}
        onNavigateBack={() => router.push(`/workspace/${workspaceId}/tables`)}
        onShowSchema={() => setShowSchemaModal(true)}
        onRefresh={refetchRows}
      />

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
          onClearSelection={clearSelection}
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
                        <CellRenderer
                          value={row.data[column.name]}
                          column={column}
                          onCellClick={handleCellClick}
                        />
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
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalCount={totalCount}
        onPreviousPage={() => setCurrentPage((p) => Math.max(0, p - 1))}
        onNextPage={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
      />

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
            clearSelection()
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
      <RowContextMenu
        contextMenu={contextMenu}
        onClose={closeContextMenu}
        onEdit={handleContextMenuEdit}
        onDelete={handleContextMenuDelete}
      />
    </div>
  )
}
