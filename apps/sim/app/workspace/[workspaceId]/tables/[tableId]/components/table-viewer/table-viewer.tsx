'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Badge,
  Checkbox,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/emcn'
import type { TableRow as TableRowType } from '@/lib/table'
import { useUpdateTableRow } from '@/hooks/queries/tables'
import { useContextMenu, useRowSelection, useTableData } from '../../hooks'
import type { CellViewerData, EditingCell, QueryOptions } from '../../types'
import { ActionBar } from '../action-bar'
import { EmptyRows, LoadingRows } from '../body-states'
import { CellViewerModal } from '../cell-viewer-modal'
import { ContextMenu } from '../context-menu'
import { HeaderBar } from '../header-bar'
import { Pagination } from '../pagination'
import { QueryBuilder } from '../query-builder'
import { RowModal } from '../row-modal'
import { SchemaModal } from '../schema-modal'
import { TableRowCells } from '../table-row-cells'

const EMPTY_COLUMNS: never[] = []

export function TableViewer() {
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

  const [cellViewer, setCellViewer] = useState<CellViewerData | null>(null)
  const [copied, setCopied] = useState(false)

  const { tableData, isLoadingTable, rows, totalCount, totalPages, isLoadingRows, refetchRows } =
    useTableData({
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

  const handleShowSchema = useCallback(() => {
    setShowSchemaModal(true)
  }, [])

  const handleAddRow = useCallback(() => {
    setShowAddModal(true)
  }, [])

  const handleApplyQueryOptions = useCallback((options: QueryOptions) => {
    setQueryOptions(options)
    setCurrentPage(0)
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
      <HeaderBar
        tableName={tableData.name}
        totalCount={totalCount}
        isLoading={isLoadingRows}
        onNavigateBack={handleNavigateBack}
        onShowSchema={handleShowSchema}
        onRefresh={refetchRows}
      />

      <div className='flex shrink-0 flex-col gap-[8px] border-[var(--border)] border-b px-[16px] py-[10px]'>
        <QueryBuilder
          columns={columns}
          onApply={handleApplyQueryOptions}
          onAddRow={handleAddRow}
          isLoading={isLoadingRows}
        />
        {hasSelection && (
          <span className='text-[11px] text-[var(--text-tertiary)]'>{selectedCount} selected</span>
        )}
      </div>

      {hasSelection && (
        <ActionBar
          selectedCount={selectedCount}
          onDelete={handleDeleteSelected}
          onClearSelection={clearSelection}
        />
      )}

      <div className='flex-1 overflow-auto'>
        <Table>
          <TableHeader className='sticky top-0 z-10 bg-[var(--surface-3)]'>
            <TableRow>
              <TableHead className='w-[40px]'>
                <Checkbox size='sm' checked={isAllSelected} onCheckedChange={handleSelectAll} />
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoadingRows ? (
              <LoadingRows columns={columns} />
            ) : rows.length === 0 ? (
              <EmptyRows
                columnCount={columns.length}
                hasFilter={!!queryOptions.filter}
                onAddRow={handleAddRow}
              />
            ) : (
              rows.map((row) => (
                <TableRowCells
                  key={row.id}
                  row={row}
                  columns={columns}
                  isSelected={selectedRows.has(row.id)}
                  editingColumnName={editingCell?.rowId === row.id ? editingCell.columnName : null}
                  onCellClick={handleCellClick}
                  onDoubleClick={handleCellDoubleClick}
                  onSave={handleInlineSave}
                  onCancel={handleInlineCancel}
                  onBooleanToggle={handleBooleanToggle}
                  onContextMenu={handleRowContextMenu}
                  onSelectRow={handleSelectRow}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination
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
