'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import {
  Button,
  Checkbox,
  DatePicker,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import type { ColumnDefinition, TableInfo, TableRow } from '@/lib/table'
import {
  useCreateTableRow,
  useDeleteTableRow,
  useDeleteTableRows,
  useUpdateTableRow,
} from '@/hooks/queries/tables'
import { cleanCellValue, formatValueForInput } from '../../utils'

const logger = createLogger('RowModal')

export interface RowModalProps {
  mode: 'add' | 'edit' | 'delete'
  isOpen: boolean
  onClose: () => void
  table: TableInfo
  row?: TableRow
  rowIds?: string[]
  onSuccess: () => void
}

function createInitialRowData(columns: ColumnDefinition[]): Record<string, unknown> {
  const initial: Record<string, unknown> = {}
  columns.forEach((col) => {
    if (col.type === 'boolean') {
      initial[col.name] = false
    } else {
      initial[col.name] = ''
    }
  })
  return initial
}

function cleanRowData(
  columns: ColumnDefinition[],
  rowData: Record<string, unknown>
): Record<string, unknown> {
  const cleanData: Record<string, unknown> = {}

  columns.forEach((col) => {
    const value = rowData[col.name]
    try {
      cleanData[col.name] = cleanCellValue(value, col)
    } catch {
      throw new Error(`Invalid JSON for field: ${col.name}`)
    }
  })

  return cleanData
}

function getInitialRowData(
  mode: RowModalProps['mode'],
  columns: ColumnDefinition[],
  row?: TableRow
): Record<string, unknown> {
  if (mode === 'add' && columns.length > 0) {
    return createInitialRowData(columns)
  }
  if (mode === 'edit' && row) {
    return row.data
  }
  return {}
}

export function RowModal({ mode, isOpen, onClose, table, row, rowIds, onSuccess }: RowModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const tableId = table.id

  const schema = table?.schema
  const columns = schema?.columns || []

  const [rowData, setRowData] = useState<Record<string, unknown>>(() =>
    getInitialRowData(mode, columns, row)
  )
  const [error, setError] = useState<string | null>(null)
  const createRowMutation = useCreateTableRow({ workspaceId, tableId })
  const updateRowMutation = useUpdateTableRow({ workspaceId, tableId })
  const deleteRowMutation = useDeleteTableRow({ workspaceId, tableId })
  const deleteRowsMutation = useDeleteTableRows({ workspaceId, tableId })
  const isSubmitting =
    createRowMutation.isPending ||
    updateRowMutation.isPending ||
    deleteRowMutation.isPending ||
    deleteRowsMutation.isPending

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    try {
      const cleanData = cleanRowData(columns, rowData)

      if (mode === 'add') {
        await createRowMutation.mutateAsync({ data: cleanData })
      } else if (mode === 'edit' && row) {
        await updateRowMutation.mutateAsync({ rowId: row.id, data: cleanData })
      }

      onSuccess()
    } catch (err) {
      logger.error(`Failed to ${mode} row:`, err)
      setError(err instanceof Error ? err.message : `Failed to ${mode} row`)
    }
  }

  const handleDelete = async () => {
    setError(null)

    const idsToDelete = rowIds ?? (row ? [row.id] : [])

    try {
      if (idsToDelete.length === 1) {
        await deleteRowMutation.mutateAsync(idsToDelete[0])
      } else {
        await deleteRowsMutation.mutateAsync(idsToDelete)
      }

      onSuccess()
    } catch (err) {
      logger.error('Failed to delete row(s):', err)
      setError(err instanceof Error ? err.message : 'Failed to delete row(s)')
    }
  }

  const handleClose = () => {
    setRowData({})
    setError(null)
    onClose()
  }

  if (mode === 'delete') {
    const deleteCount = rowIds?.length ?? (row ? 1 : 0)
    const isSingleRow = deleteCount === 1

    return (
      <Modal open={isOpen} onOpenChange={handleClose}>
        <ModalContent size='sm'>
          <ModalHeader>Delete {isSingleRow ? 'Row' : `${deleteCount} Rows`}</ModalHeader>
          <ModalBody>
            {error && (
              <div className='rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-bg)] px-3.5 py-3 text-[var(--status-error-text)] text-small'>
                {error}
              </div>
            )}
            <p className='text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              {isSingleRow ? 'this row' : `these ${deleteCount} rows`}? This will permanently remove
              all data in {isSingleRow ? 'this row' : 'these rows'}.{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDelete} disabled={isSubmitting}>
              {isSubmitting ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    )
  }

  const isAddMode = mode === 'add'

  return (
    <Modal open={isOpen} onOpenChange={handleClose}>
      <ModalContent size='lg'>
        <ModalHeader>
          <div className='flex flex-col gap-1'>
            <h2 className='font-semibold text-md'>{isAddMode ? 'Add New Row' : 'Edit Row'}</h2>
            <p className='font-normal text-[var(--text-tertiary)] text-small'>
              {isAddMode ? 'Fill in the values for' : 'Update values for'} {table?.name ?? 'table'}
            </p>
          </div>
        </ModalHeader>
        <ModalBody className='max-h-[60vh] overflow-y-auto'>
          <form onSubmit={handleFormSubmit} className='flex flex-col gap-4'>
            <ErrorMessage error={error} />

            {columns.map((column) => (
              <ColumnField
                key={column.name}
                column={column}
                value={rowData[column.name]}
                onChange={(value) => setRowData((prev) => ({ ...prev, [column.name]: value }))}
              />
            ))}
          </form>
        </ModalBody>
        <ModalFooter className='gap-2.5'>
          <Button
            type='button'
            variant='default'
            onClick={handleClose}
            className='min-w-[90px]'
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type='button'
            variant='primary'
            onClick={handleFormSubmit}
            disabled={isSubmitting}
            className='min-w-[120px]'
          >
            {isSubmitting
              ? isAddMode
                ? 'Adding...'
                : 'Updating...'
              : isAddMode
                ? 'Add Row'
                : 'Update Row'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

function ErrorMessage({ error }: { error: string | null }) {
  if (!error) return null

  return (
    <div className='rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-bg)] px-3.5 py-3 text-[var(--status-error-text)] text-small'>
      {error}
    </div>
  )
}

interface ColumnFieldProps {
  column: ColumnDefinition
  value: unknown
  onChange: (value: unknown) => void
}

function ColumnField({ column, value, onChange }: ColumnFieldProps) {
  return (
    <div className='flex flex-col gap-2'>
      <Label htmlFor={column.name} className='font-medium text-small'>
        {column.name}
        {column.required && <span className='text-[var(--text-error)]'> *</span>}
        {column.unique && (
          <span className='ml-1.5 font-normal text-[var(--text-tertiary)] text-xs'>(unique)</span>
        )}
      </Label>

      {column.type === 'boolean' ? (
        <div className='flex items-center gap-2'>
          <Checkbox
            id={column.name}
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          <Label
            htmlFor={column.name}
            className='font-normal text-[var(--text-tertiary)] text-small'
          >
            {value ? 'True' : 'False'}
          </Label>
        </div>
      ) : column.type === 'json' ? (
        <Textarea
          id={column.name}
          value={formatValueForInput(value, column.type)}
          onChange={(e) => onChange(e.target.value)}
          placeholder='{"key": "value"}'
          rows={4}
          className='font-mono text-caption'
          required={column.required}
        />
      ) : column.type === 'date' ? (
        <DatePicker
          mode='single'
          value={formatValueForInput(value, column.type) || undefined}
          onChange={(dateStr) => onChange(dateStr)}
          placeholder='Select date'
        />
      ) : (
        <Input
          id={column.name}
          type={column.type === 'number' ? 'number' : 'text'}
          value={formatValueForInput(value, column.type)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${column.name}`}
          className='h-[38px]'
          required={column.required}
        />
      )}

      <div className='text-[var(--text-tertiary)] text-caption'>
        Type: {column.type}
        {!column.required && ' (optional)'}
      </div>
    </div>
  )
}
