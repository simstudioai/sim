'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
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

const logger = createLogger('EditRowModal')

/**
 * Represents row data from the table.
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
 * Table metadata needed for the edit row modal.
 */
interface TableInfo {
  /** Unique identifier for the table */
  id: string
  /** Table name for display */
  name: string
  /** Schema defining columns */
  schema: TableSchema
}

/**
 * Props for the EditRowModal component.
 */
interface EditRowModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when the modal should close */
  onClose: () => void
  /** Table containing the row */
  table: TableInfo
  /** Row being edited */
  row: TableRowData
  /** Callback when row is successfully updated */
  onSuccess: () => void
}

/** Row data being edited in the form */
type RowFormData = Record<string, unknown>

/**
 * Cleans and transforms form data for API submission.
 *
 * @param columns - Column definitions
 * @param rowData - Form data to clean
 * @returns Cleaned data object ready for API
 * @throws Error if JSON parsing fails
 */
function cleanRowData(columns: ColumnDefinition[], rowData: RowFormData): Record<string, unknown> {
  const cleanData: Record<string, unknown> = {}

  columns.forEach((col) => {
    const value = rowData[col.name]
    if (col.type === 'number') {
      cleanData[col.name] = value === '' ? null : Number(value)
    } else if (col.type === 'json') {
      if (typeof value === 'string') {
        try {
          cleanData[col.name] = JSON.parse(value)
        } catch {
          throw new Error(`Invalid JSON for field: ${col.name}`)
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
 *
 * @param value - The value to format
 * @param type - The column type
 * @returns Formatted string value
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
 * Modal component for editing an existing table row.
 *
 * @remarks
 * Generates form fields based on the table schema and validates
 * input before submission.
 *
 * @example
 * ```tsx
 * <EditRowModal
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   table={tableData}
 *   row={selectedRow}
 *   onSuccess={() => refetchRows()}
 * />
 * ```
 */
export function EditRowModal({ isOpen, onClose, table, row, onSuccess }: EditRowModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const schema = table?.schema
  const columns = schema?.columns || []

  const [rowData, setRowData] = useState<RowFormData>(row.data)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setRowData(row.data)
  }, [row.data])

  /**
   * Handles form submission.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const cleanData = cleanRowData(columns, rowData)

      const res = await fetch(`/api/table/${table?.id}/rows/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          data: cleanData,
        }),
      })

      const result: { error?: string } = await res.json()

      if (!res.ok) {
        throw new Error(result.error || 'Failed to update row')
      }

      onSuccess()
    } catch (err) {
      logger.error('Failed to update row:', err)
      setError(err instanceof Error ? err.message : 'Failed to update row')
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * Handles modal close and resets state.
   */
  const handleClose = () => {
    setError(null)
    onClose()
  }

  return (
    <Modal open={isOpen} onOpenChange={handleClose}>
      <ModalContent className='w-[600px]'>
        <ModalHeader>
          <div className='flex flex-col gap-[4px]'>
            <h2 className='font-semibold text-[16px]'>Edit Row</h2>
            <p className='font-normal text-[13px] text-[var(--text-tertiary)]'>
              Update values for {table?.name ?? 'table'}
            </p>
          </div>
        </ModalHeader>
        <ModalBody className='max-h-[60vh] overflow-y-auto'>
          <form onSubmit={handleSubmit} className='flex flex-col gap-[16px]'>
            {error && (
              <div className='rounded-[8px] border border-[var(--status-error-border)] bg-[var(--status-error-bg)] px-[14px] py-[12px] text-[13px] text-[var(--status-error-text)]'>
                {error}
              </div>
            )}

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
            onClick={handleSubmit}
            disabled={isSubmitting}
            className='min-w-[120px]'
          >
            {isSubmitting ? 'Updating...' : 'Update Row'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
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
