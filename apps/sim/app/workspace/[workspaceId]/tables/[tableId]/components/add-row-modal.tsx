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

const logger = createLogger('AddRowModal')

/**
 * Table metadata needed for the add row modal.
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
 * Props for the AddRowModal component.
 */
interface AddRowModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when the modal should close */
  onClose: () => void
  /** Table to add the row to */
  table: TableInfo
  /** Callback when row is successfully added */
  onSuccess: () => void
}

/** Row data being edited in the form */
type RowFormData = Record<string, string | boolean>

/**
 * Creates initial form data for columns.
 *
 * @param columns - Column definitions
 * @returns Initial row data with default values
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
    if (col.required || (value !== '' && value !== null && value !== undefined)) {
      if (col.type === 'number') {
        cleanData[col.name] = value === '' ? null : Number(value)
      } else if (col.type === 'json') {
        if (value === '') {
          cleanData[col.name] = null
        } else {
          try {
            cleanData[col.name] = JSON.parse(value as string)
          } catch {
            throw new Error(`Invalid JSON for field: ${col.name}`)
          }
        }
      } else if (col.type === 'boolean') {
        cleanData[col.name] = Boolean(value)
      } else {
        cleanData[col.name] = value || null
      }
    }
  })

  return cleanData
}

/**
 * Modal component for adding a new row to a table.
 *
 * @remarks
 * Generates form fields based on the table schema and validates
 * input before submission.
 *
 * @example
 * ```tsx
 * <AddRowModal
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   table={tableData}
 *   onSuccess={() => refetchRows()}
 * />
 * ```
 */
export function AddRowModal({ isOpen, onClose, table, onSuccess }: AddRowModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const schema = table?.schema
  const columns = schema?.columns || []

  const [rowData, setRowData] = useState<RowFormData>({})
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen && columns.length > 0) {
      setRowData(createInitialRowData(columns))
    }
  }, [isOpen, columns])

  /**
   * Handles form submission.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const cleanData = cleanRowData(columns, rowData)

      const res = await fetch(`/api/table/${table?.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          data: cleanData,
        }),
      })

      const result: { error?: string } = await res.json()

      if (!res.ok) {
        throw new Error(result.error || 'Failed to add row')
      }

      onSuccess()
    } catch (err) {
      logger.error('Failed to add row:', err)
      setError(err instanceof Error ? err.message : 'Failed to add row')
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

  return (
    <Modal open={isOpen} onOpenChange={handleClose}>
      <ModalContent className='w-[600px]'>
        <ModalHeader>
          <div className='flex flex-col gap-[4px]'>
            <h2 className='font-semibold text-[16px]'>Add New Row</h2>
            <p className='font-normal text-[13px] text-[var(--text-tertiary)]'>
              Fill in the values for {table?.name ?? 'table'}
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
            {isSubmitting ? 'Adding...' : 'Add Row'}
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
  value: string | boolean | undefined
  /** Callback when value changes */
  onChange: (value: string | boolean) => void
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
          value={String(value ?? '')}
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
          value={String(value ?? '')}
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
