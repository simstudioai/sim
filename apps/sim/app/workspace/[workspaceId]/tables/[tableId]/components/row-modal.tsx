'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { AlertCircle } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Checkbox,
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
    if (col.type === 'number') {
      cleanData[col.name] = value === '' ? null : Number(value)
    } else if (col.type === 'json') {
      if (typeof value === 'string') {
        if (value === '') {
          cleanData[col.name] = null
        } else {
          try {
            cleanData[col.name] = JSON.parse(value)
          } catch {
            throw new Error(`Invalid JSON for field: ${col.name}`)
          }
        }
      } else {
        cleanData[col.name] = value
      }
    } else if (col.type === 'boolean') {
      cleanData[col.name] = Boolean(value)
    } else {
      cleanData[col.name] = value || null
    }
  })

  return cleanData
}

function formatValueForInput(value: unknown, type: string): string {
  if (value === null || value === undefined) return ''
  if (type === 'json') {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  }
  if (type === 'date' && value) {
    try {
      const date = new Date(String(value))
      return date.toISOString().split('T')[0]
    } catch {
      return String(value)
    }
  }
  return String(value)
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
        await createRowMutation.mutateAsync(cleanData)
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

  // Delete mode UI
  if (mode === 'delete') {
    const deleteCount = rowIds?.length ?? (row ? 1 : 0)
    const isSingleRow = deleteCount === 1

    return (
      <Modal open={isOpen} onOpenChange={handleClose}>
        <ModalContent className='w-[480px]'>
          <ModalHeader>
            <div className='flex items-center gap-[10px]'>
              <div className='flex h-[36px] w-[36px] items-center justify-center rounded-[8px] bg-[var(--bg-error)] text-[var(--text-error)]'>
                <AlertCircle className='h-[18px] w-[18px]' />
              </div>
              <h2 className='font-semibold text-[16px]'>
                Delete {isSingleRow ? 'Row' : `${deleteCount} Rows`}
              </h2>
            </div>
          </ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-[16px]'>
              <ErrorMessage error={error} />
              <p className='text-[14px] text-[var(--text-secondary)]'>
                Are you sure you want to delete {isSingleRow ? 'this row' : 'these rows'}? This
                action cannot be undone.
              </p>
            </div>
          </ModalBody>
          <ModalFooter className='gap-[10px]'>
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
              variant='destructive'
              onClick={handleDelete}
              disabled={isSubmitting}
              className='min-w-[120px]'
            >
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
      <ModalContent className='w-[600px]'>
        <ModalHeader>
          <div className='flex flex-col gap-[4px]'>
            <h2 className='font-semibold text-[16px]'>{isAddMode ? 'Add New Row' : 'Edit Row'}</h2>
            <p className='font-normal text-[13px] text-[var(--text-tertiary)]'>
              {isAddMode ? 'Fill in the values for' : 'Update values for'} {table?.name ?? 'table'}
            </p>
          </div>
        </ModalHeader>
        <ModalBody className='max-h-[60vh] overflow-y-auto'>
          <form onSubmit={handleFormSubmit} className='flex flex-col gap-[16px]'>
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
        <ModalFooter className='gap-[10px]'>
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
            variant='tertiary'
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
    <div className='rounded-[8px] border border-[var(--status-error-border)] bg-[var(--status-error-bg)] px-[14px] py-[12px] text-[13px] text-[var(--status-error-text)]'>
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
    <div className='flex flex-col gap-[8px]'>
      <Label htmlFor={column.name} className='font-medium text-[13px]'>
        {column.name}
        {column.required && <span className='text-[var(--text-error)]'> *</span>}
        {column.unique && (
          <span className='ml-[6px] font-normal text-[11px] text-[var(--text-tertiary)]'>
            (unique)
          </span>
        )}
      </Label>

      {column.type === 'boolean' ? (
        <div className='flex items-center gap-[8px]'>
          <Checkbox
            id={column.name}
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          <Label
            htmlFor={column.name}
            className='font-normal text-[13px] text-[var(--text-tertiary)]'
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
          className='font-mono text-[12px]'
          required={column.required}
        />
      ) : (
        <Input
          id={column.name}
          type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
          value={formatValueForInput(value, column.type)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${column.name}`}
          className='h-[38px]'
          required={column.required}
        />
      )}

      <div className='text-[12px] text-[var(--text-tertiary)]'>
        Type: {column.type}
        {!column.required && ' (optional)'}
      </div>
    </div>
  )
}
