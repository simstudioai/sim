'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { Plus, Trash2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Checkbox,
  Combobox,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import type { ColumnDefinition, ColumnType } from '@/lib/table'
import { useCreateTable } from '@/hooks/queries/use-tables'

const logger = createLogger('CreateTableModal')

/**
 * Props for the CreateTableModal component.
 */
interface CreateTableModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when the modal should close */
  onClose: () => void
}

/**
 * Available column type options for the combobox UI.
 */
const COLUMN_TYPE_OPTIONS: Array<{ value: ColumnType; label: string }> = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'json', label: 'JSON' },
]

/**
 * Creates an empty column definition with default values.
 */
function createEmptyColumn(): ColumnDefinition {
  return { name: '', type: 'string', required: true, unique: false }
}

/**
 * Modal component for creating a new table in a workspace.
 *
 * @remarks
 * This modal allows users to:
 * - Set a table name and description
 * - Define columns with name, type, and constraints
 * - Create the table via the API
 *
 * @example
 * ```tsx
 * <CreateTableModal
 *   isOpen={isModalOpen}
 *   onClose={() => setIsModalOpen(false)}
 * />
 * ```
 */
export function CreateTableModal({ isOpen, onClose }: CreateTableModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [tableName, setTableName] = useState('')
  const [description, setDescription] = useState('')
  const [columns, setColumns] = useState<ColumnDefinition[]>([createEmptyColumn()])
  const [error, setError] = useState<string | null>(null)

  const createTable = useCreateTable(workspaceId)

  /**
   * Adds a new empty column to the schema.
   */
  const handleAddColumn = () => {
    setColumns([...columns, createEmptyColumn()])
  }

  /**
   * Removes a column from the schema by index.
   *
   * @param index - Index of the column to remove
   */
  const handleRemoveColumn = (index: number) => {
    if (columns.length > 1) {
      setColumns(columns.filter((_, i) => i !== index))
    }
  }

  /**
   * Updates a column field at the specified index.
   *
   * @param index - Index of the column to update
   * @param field - Field name to update
   * @param value - New value for the field
   */
  const handleColumnChange = (
    index: number,
    field: keyof ColumnDefinition,
    value: string | boolean
  ) => {
    const newColumns = [...columns]
    newColumns[index] = { ...newColumns[index], [field]: value }
    setColumns(newColumns)
  }

  /**
   * Validates and submits the form to create the table.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!tableName.trim()) {
      setError('Table name is required')
      return
    }

    // Validate column names
    const validColumns = columns.filter((col) => col.name.trim())
    if (validColumns.length === 0) {
      setError('At least one column is required')
      return
    }

    // Check for duplicate column names
    const columnNames = validColumns.map((col) => col.name.toLowerCase())
    const uniqueNames = new Set(columnNames)
    if (uniqueNames.size !== columnNames.length) {
      setError('Duplicate column names found')
      return
    }

    try {
      await createTable.mutateAsync({
        name: tableName,
        description: description || undefined,
        schema: {
          columns: validColumns,
        },
      })

      // Reset form
      resetForm()
      onClose()
    } catch (err) {
      logger.error('Failed to create table:', err)
      setError(err instanceof Error ? err.message : 'Failed to create table')
    }
  }

  /**
   * Resets all form fields to their initial state.
   */
  const resetForm = () => {
    setTableName('')
    setDescription('')
    setColumns([createEmptyColumn()])
    setError(null)
  }

  /**
   * Handles modal close and resets form state.
   */
  const handleClose = () => {
    resetForm()
    onClose()
  }

  return (
    <Modal open={isOpen} onOpenChange={handleClose}>
      <ModalContent className='w-[700px]'>
        <ModalHeader>
          <div className='flex flex-col gap-[4px]'>
            <h2 className='font-semibold text-[16px]'>Create New Table</h2>
            <p className='font-normal text-[13px] text-[var(--text-tertiary)]'>
              Define your table schema with columns and constraints
            </p>
          </div>
        </ModalHeader>
        <ModalBody className='max-h-[70vh] overflow-y-auto'>
          <form onSubmit={handleSubmit} className='flex flex-col gap-[20px]'>
            {error && (
              <div className='rounded-[8px] border border-[var(--status-error-border)] bg-[var(--status-error-bg)] px-[14px] py-[12px] text-[13px] text-[var(--status-error-text)]'>
                {error}
              </div>
            )}

            {/* Table Name */}
            <div className='flex flex-col gap-[8px]'>
              <Label htmlFor='tableName' className='font-medium text-[13px]'>
                Table Name*
              </Label>
              <Input
                id='tableName'
                value={tableName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTableName(e.target.value)}
                placeholder='customers, orders, products'
                className='h-[38px]'
                required
              />
              <p className='text-[12px] text-[var(--text-tertiary)]'>
                Use lowercase with underscores (e.g., customer_orders)
              </p>
            </div>

            {/* Description */}
            <div className='flex flex-col gap-[8px]'>
              <Label htmlFor='description' className='font-medium text-[13px]'>
                Description
              </Label>
              <Textarea
                id='description'
                value={description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setDescription(e.target.value)
                }
                placeholder='Optional description for this table'
                rows={2}
                className='resize-none'
              />
            </div>

            {/* Columns */}
            <div className='flex flex-col gap-[14px]'>
              <div className='flex items-center justify-between'>
                <Label className='font-medium text-[13px]'>Columns*</Label>
                <Button
                  type='button'
                  size='sm'
                  variant='default'
                  onClick={handleAddColumn}
                  className='h-[30px] rounded-[6px] px-[12px] text-[12px]'
                >
                  <Plus className='mr-[4px] h-[14px] w-[14px]' />
                  Add Column
                </Button>
              </div>

              {/* Column Headers */}
              <div className='flex items-center gap-[10px] rounded-[6px] bg-[var(--bg-secondary)] px-[12px] py-[8px] font-semibold text-[11px] text-[var(--text-tertiary)]'>
                <div className='flex-1'>Column Name</div>
                <div className='w-[110px]'>Type</div>
                <div className='w-[70px] text-center'>Required</div>
                <div className='w-[70px] text-center'>Unique</div>
                <div className='w-[36px]' />
              </div>

              {/* Column Rows */}
              <div className='flex flex-col gap-[10px]'>
                {columns.map((column, index) => (
                  <ColumnRow
                    key={index}
                    column={column}
                    index={index}
                    isRemovable={columns.length > 1}
                    onChange={handleColumnChange}
                    onRemove={handleRemoveColumn}
                  />
                ))}
              </div>

              <p className='text-[12px] text-[var(--text-tertiary)]'>
                Mark columns as <span className='font-medium'>unique</span> to prevent duplicate
                values (e.g., id, email)
              </p>
            </div>
          </form>
        </ModalBody>
        <ModalFooter className='gap-[10px]'>
          <Button
            type='button'
            variant='default'
            onClick={handleClose}
            className='min-w-[90px]'
            disabled={createTable.isPending}
          >
            Cancel
          </Button>
          <Button
            type='button'
            variant='tertiary'
            onClick={handleSubmit}
            disabled={createTable.isPending}
            className='min-w-[120px]'
          >
            {createTable.isPending ? 'Creating...' : 'Create Table'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

/**
 * Props for the ColumnRow component.
 */
interface ColumnRowProps {
  /** The column definition */
  column: ColumnDefinition
  /** Index of this column in the list */
  index: number
  /** Whether the remove button should be enabled */
  isRemovable: boolean
  /** Callback when a column field changes */
  onChange: (index: number, field: keyof ColumnDefinition, value: string | boolean) => void
  /** Callback to remove this column */
  onRemove: (index: number) => void
}

/**
 * A single row in the column definition list.
 */
function ColumnRow({ column, index, isRemovable, onChange, onRemove }: ColumnRowProps) {
  return (
    <div className='flex items-center gap-[10px]'>
      {/* Column Name */}
      <div className='flex-1'>
        <Input
          value={column.name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChange(index, 'name', e.target.value)
          }
          placeholder='column_name'
          className='h-[36px]'
        />
      </div>

      {/* Column Type */}
      <div className='w-[110px]'>
        <Combobox
          options={COLUMN_TYPE_OPTIONS}
          value={column.type}
          selectedValue={column.type}
          onChange={(value) => onChange(index, 'type', value as ColumnType)}
          placeholder='Type'
          editable={false}
          filterOptions={false}
          className='h-[36px]'
        />
      </div>

      {/* Required Checkbox */}
      <div className='flex w-[70px] items-center justify-center'>
        <Checkbox
          checked={column.required}
          onCheckedChange={(checked) => onChange(index, 'required', checked === true)}
        />
      </div>

      {/* Unique Checkbox */}
      <div className='flex w-[70px] items-center justify-center'>
        <Checkbox
          checked={column.unique}
          onCheckedChange={(checked) => onChange(index, 'unique', checked === true)}
        />
      </div>

      {/* Delete Button */}
      <div className='w-[36px]'>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          onClick={() => onRemove(index)}
          disabled={!isRemovable}
          className='h-[36px] w-[36px] p-0 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-error)] hover:text-[var(--text-error)]'
        >
          <Trash2 className='h-[15px] w-[15px]' />
        </Button>
      </div>
    </div>
  )
}
