'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { Plus, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
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
import { cn } from '@/lib/core/utils/cn'
import type { ColumnDefinition } from '@/lib/table'
import { useCreateTable } from '@/hooks/queries/tables'

const logger = createLogger('CreateModal')

interface CreateModalProps {
  isOpen: boolean
  onClose: () => void
}

const COLUMN_TYPE_OPTIONS: Array<{ value: ColumnDefinition['type']; label: string }> = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'json', label: 'JSON' },
]

interface ColumnWithId extends ColumnDefinition {
  id: string
}

function createEmptyColumn(): ColumnWithId {
  return { id: nanoid(), name: '', type: 'string', required: true, unique: false }
}

export function CreateModal({ isOpen, onClose }: CreateModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [tableName, setTableName] = useState('')
  const [description, setDescription] = useState('')
  const [columns, setColumns] = useState<ColumnWithId[]>([createEmptyColumn()])
  const [error, setError] = useState<string | null>(null)

  const createTable = useCreateTable(workspaceId)

  const handleAddColumn = () => {
    setColumns([...columns, createEmptyColumn()])
  }

  const handleRemoveColumn = (columnId: string) => {
    if (columns.length > 1) {
      setColumns(columns.filter((col) => col.id !== columnId))
    }
  }

  const handleColumnChange = (
    columnId: string,
    field: keyof ColumnDefinition,
    value: string | boolean
  ) => {
    setColumns(columns.map((col) => (col.id === columnId ? { ...col, [field]: value } : col)))
  }

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

    // Strip internal IDs before sending to API
    const columnsForApi = validColumns.map(({ id: _id, ...col }) => col)

    try {
      await createTable.mutateAsync({
        name: tableName,
        description: description || undefined,
        schema: {
          columns: columnsForApi,
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

  const resetForm = () => {
    setTableName('')
    setDescription('')
    setColumns([createEmptyColumn()])
    setError(null)
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  return (
    <Modal open={isOpen} onOpenChange={handleClose}>
      <ModalContent size='lg'>
        <ModalHeader>Create Table</ModalHeader>

        <form onSubmit={handleSubmit} className='flex min-h-0 flex-1 flex-col'>
          <ModalBody>
            <div className='min-h-0 flex-1 overflow-y-auto'>
              <div className='space-y-[12px]'>
                <p className='text-[12px] text-[var(--text-tertiary)]'>
                  Define your table schema with columns and constraints.
                </p>

                {error && (
                  <p className='text-[12px] text-[var(--text-error)] leading-tight'>{error}</p>
                )}

                <div className='flex flex-col gap-[8px]'>
                  <Label htmlFor='tableName'>Name</Label>
                  <Input
                    id='tableName'
                    value={tableName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTableName(e.target.value)
                    }
                    placeholder='customers, orders, products'
                    className={cn(
                      error === 'Table name is required' && 'border-[var(--text-error)]'
                    )}
                    required
                  />
                  <p className='text-[11px] text-[var(--text-muted)]'>
                    Use lowercase with underscores (e.g., customer_orders)
                  </p>
                </div>

                <div className='flex flex-col gap-[8px]'>
                  <Label htmlFor='description'>Description</Label>
                  <Textarea
                    id='description'
                    value={description}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setDescription(e.target.value)
                    }
                    placeholder='Optional description for this table'
                    rows={3}
                    className='resize-none'
                  />
                </div>

                <div className='space-y-[8px]'>
                  <div className='flex items-center justify-between'>
                    <Label>Columns*</Label>
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

                  <div className='space-y-[8px]'>
                    {columns.map((column, index) => (
                      <ColumnRow
                        key={column.id}
                        index={index}
                        column={column}
                        isRemovable={columns.length > 1}
                        onChange={handleColumnChange}
                        onRemove={handleRemoveColumn}
                      />
                    ))}
                  </div>

                  <p className='text-[11px] text-[var(--text-muted)]'>
                    Mark columns as <span className='font-medium'>unique</span> to prevent duplicate
                    values (e.g., id, email)
                  </p>
                </div>
              </div>
            </div>
          </ModalBody>

          <ModalFooter>
            <div className='flex w-full items-center justify-end gap-[8px]'>
              <Button
                type='button'
                variant='default'
                onClick={handleClose}
                disabled={createTable.isPending}
              >
                Cancel
              </Button>
              <Button
                type='submit'
                variant='tertiary'
                disabled={createTable.isPending}
                className='min-w-[120px]'
              >
                {createTable.isPending ? 'Creating...' : 'Create Table'}
              </Button>
            </div>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}

interface ColumnRowProps {
  index: number
  column: ColumnWithId
  isRemovable: boolean
  onChange: (columnId: string, field: keyof ColumnDefinition, value: string | boolean) => void
  onRemove: (columnId: string) => void
}

function ColumnRow({ index, column, isRemovable, onChange, onRemove }: ColumnRowProps) {
  return (
    <div className='rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-1)] p-[10px]'>
      <div className='mb-[8px] flex items-center justify-between'>
        <span className='font-medium text-[11px] text-[var(--text-tertiary)]'>
          Column {index + 1}
        </span>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          onClick={() => onRemove(column.id)}
          disabled={!isRemovable}
          className='h-[28px] w-[28px] p-0 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-error)] hover:text-[var(--text-error)]'
        >
          <Trash2 className='h-[15px] w-[15px]' />
        </Button>
      </div>

      <div className='grid grid-cols-[minmax(0,1fr)_120px_76px_76px] items-end gap-[10px]'>
        <div className='flex flex-col gap-[6px]'>
          <Label
            htmlFor={`column-name-${column.id}`}
            className='text-[11px] text-[var(--text-muted)]'
          >
            Name
          </Label>
          <Input
            id={`column-name-${column.id}`}
            value={column.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onChange(column.id, 'name', e.target.value)
            }
            placeholder='column_name'
            className='h-[36px]'
          />
        </div>

        <div className='flex flex-col gap-[6px]'>
          <Label
            htmlFor={`column-type-${column.id}`}
            className='text-[11px] text-[var(--text-muted)]'
          >
            Type
          </Label>
          <Combobox
            options={COLUMN_TYPE_OPTIONS}
            value={column.type}
            selectedValue={column.type}
            onChange={(value) => onChange(column.id, 'type', value as ColumnDefinition['type'])}
            placeholder='Type'
            editable={false}
            filterOptions={false}
            className='h-[36px]'
          />
        </div>

        <div className='flex flex-col items-center gap-[8px]'>
          <span className='text-[11px] text-[var(--text-tertiary)]'>Required</span>
          <Checkbox
            checked={column.required}
            onCheckedChange={(checked) => onChange(column.id, 'required', checked === true)}
          />
        </div>

        <div className='flex flex-col items-center gap-[8px]'>
          <span className='text-[11px] text-[var(--text-tertiary)]'>Unique</span>
          <Checkbox
            checked={column.unique}
            onCheckedChange={(checked) => onChange(column.id, 'unique', checked === true)}
          />
        </div>
      </div>
    </div>
  )
}
