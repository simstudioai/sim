'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { AlertCircle } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Checkbox,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import { Input } from '@/components/ui/input'
import type { ColumnDefinition, TableSchema } from '@/lib/table'

const logger = createLogger('TableRowModal')

/**
 * Represents row data from the table.
 */
export interface TableRowData {
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
 * Table metadata needed for row operations.
 */
export interface TableInfo {
  /** Unique identifier for the table */
  id: string
  /** Table name for display */
  name: string
  /** Schema defining columns */
  schema: TableSchema
}

/**
 * Modal mode determines the operation and UI.
 */
export type TableRowModalMode = 'add' | 'edit' | 'delete'

/**
 * Props for the TableRowModal component.
 */
export interface TableRowModalProps {
  /** The operation mode */
  mode: TableRowModalMode
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when the modal should close */
  onClose: () => void
  /** Table to operate on */
  table: TableInfo
  /** Row being edited/deleted (required for edit/delete modes) */
  row?: TableRowData
  /** Row IDs to delete (for delete mode batch operations) */
  rowIds?: string[]
  /** Callback when operation is successful */
  onSuccess: () => void
}

/** Row data being edited in the form */
type RowFormData = Record<string, unknown>

/**
 * Creates initial form data for columns.
 */
function createInitialRowData(columns: ColumnDefinition[]): RowFormData {
  const initial: RowFormData = {}
  columns.forEach((col) => {
    if (col.type === 'boolean') {
      initial[col.name] = false
    } else {
      initial[col.name] = ''
    }
  })
  return initial
}

/**
 * Cleans and transforms form data for API submission.
 */
function cleanRowData(columns: ColumnDefinition[], rowData: RowFormData): Record<string, unknown> {
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

/**
 * Formats a value for display in the input field.
 */
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

/**
 * Unified modal component for add, edit, and delete row operations.
 *
 * @example Add mode:
 * ```tsx
 * <TableRowModal
 *   mode="add"
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   table={tableData}
 *   onSuccess={() => refetchRows()}
 * />
 * ```
 *
 * @example Edit mode:
 * ```tsx
 * <TableRowModal
 *   mode="edit"
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   table={tableData}
 *   row={selectedRow}
 *   onSuccess={() => refetchRows()}
 * />
 * ```
 *
 * @example Delete mode:
 * ```tsx
 * <TableRowModal
 *   mode="delete"
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   table={tableData}
 *   rowIds={selectedRowIds}
 *   onSuccess={() => refetchRows()}
 * />
 * ```
 */
export function TableRowModal({
  mode,
  isOpen,
  onClose,
  table,
  row,
  rowIds,
  onSuccess,
}: TableRowModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const schema = table?.schema
  const columns = schema?.columns || []

  const [rowData, setRowData] = useState<RowFormData>({})
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Initialize form data based on mode
  useEffect(() => {
    if (!isOpen) return

    if (mode === 'add' && columns.length > 0) {
      setRowData(createInitialRowData(columns))
    } else if (mode === 'edit' && row) {
      setRowData(row.data)
    }
  }, [isOpen, mode, columns, row])

  /**
   * Handles add/edit form submission.
   */
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const cleanData = cleanRowData(columns, rowData)

      if (mode === 'add') {
        const res = await fetch(`/api/table/${table?.id}/rows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, data: cleanData }),
        })

        const result: { error?: string } = await res.json()
        if (!res.ok) {
          throw new Error(result.error || 'Failed to add row')
        }
      } else if (mode === 'edit' && row) {
        const res = await fetch(`/api/table/${table?.id}/rows/${row.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, data: cleanData }),
        })

        const result: { error?: string } = await res.json()
        if (!res.ok) {
          throw new Error(result.error || 'Failed to update row')
        }
      }

      onSuccess()
    } catch (err) {
      logger.error(`Failed to ${mode} row:`, err)
      setError(err instanceof Error ? err.message : `Failed to ${mode} row`)
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * Handles delete operation.
   */
  const handleDelete = async () => {
    setError(null)
    setIsSubmitting(true)

    const idsToDelete = rowIds ?? (row ? [row.id] : [])

    try {
      if (idsToDelete.length === 1) {
        const res = await fetch(`/api/table/${table?.id}/rows/${idsToDelete[0]}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId }),
        })

        if (!res.ok) {
          const result: { error?: string } = await res.json()
          throw new Error(result.error || 'Failed to delete row')
        }
      } else {
        await Promise.all(
          idsToDelete.map((rowId) =>
            fetch(`/api/table/${table?.id}/rows/${rowId}`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ workspaceId }),
            })
          )
        )
      }

      onSuccess()
    } catch (err) {
      logger.error('Failed to delete row(s):', err)
      setError(err instanceof Error ? err.message : 'Failed to delete row(s)')
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * Handles modal close and resets state.
   */
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

  // Add/Edit mode UI
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

/**
 * Error message display component.
 */
function ErrorMessage({ error }: { error: string | null }) {
  if (!error) return null

  return (
    <div className='rounded-[8px] border border-[var(--status-error-border)] bg-[var(--status-error-bg)] px-[14px] py-[12px] text-[13px] text-[var(--status-error-text)]'>
      {error}
    </div>
  )
}

/**
 * Props for the ColumnField component.
 */
interface ColumnFieldProps {
  /** Column definition */
  column: ColumnDefinition
  /** Current field value */
  value: unknown
  /** Callback when value changes */
  onChange: (value: unknown) => void
}

/**
 * Renders an input field for a column based on its type.
 */
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
