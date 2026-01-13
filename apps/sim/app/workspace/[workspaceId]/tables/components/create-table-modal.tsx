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
import { useCreateTable } from '@/hooks/queries/use-tables'

const logger = createLogger('CreateTableModal')

interface ColumnDefinition {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'json'
  required: boolean
}

interface CreateTableModalProps {
  isOpen: boolean
  onClose: () => void
}

const COLUMN_TYPES = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'json', label: 'JSON' },
]

export function CreateTableModal({ isOpen, onClose }: CreateTableModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [tableName, setTableName] = useState('')
  const [description, setDescription] = useState('')
  const [columns, setColumns] = useState<ColumnDefinition[]>([
    { name: '', type: 'string', required: false },
  ])
  const [error, setError] = useState<string | null>(null)

  const createTable = useCreateTable(workspaceId)

  const handleAddColumn = () => {
    setColumns([...columns, { name: '', type: 'string', required: false }])
  }

  const handleRemoveColumn = (index: number) => {
    if (columns.length > 1) {
      setColumns(columns.filter((_, i) => i !== index))
    }
  }

  const handleColumnChange = (
    index: number,
    field: keyof ColumnDefinition,
    value: string | boolean
  ) => {
    const newColumns = [...columns]
    newColumns[index] = { ...newColumns[index], [field]: value }
    setColumns(newColumns)
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

    try {
      await createTable.mutateAsync({
        name: tableName,
        description: description || undefined,
        schema: {
          columns: validColumns,
        },
      })

      // Reset form
      setTableName('')
      setDescription('')
      setColumns([{ name: '', type: 'string', required: false }])
      setError(null)
      onClose()
    } catch (err) {
      logger.error('Failed to create table:', err)
      setError(err instanceof Error ? err.message : 'Failed to create table')
    }
  }

  const handleClose = () => {
    // Reset form on close
    setTableName('')
    setDescription('')
    setColumns([{ name: '', type: 'string', required: false }])
    setError(null)
    onClose()
  }

  return (
    <Modal open={isOpen} onOpenChange={handleClose}>
      <ModalContent className='w-[600px]'>
        <ModalHeader>Create New Table</ModalHeader>
        <ModalBody className='max-h-[70vh] overflow-y-auto'>
          <form onSubmit={handleSubmit} className='flex flex-col gap-[16px]'>
            {error && (
              <div className='rounded-[6px] border border-[var(--status-error-border)] bg-[var(--status-error-bg)] px-[12px] py-[10px] text-[12px] text-[var(--status-error-text)]'>
                {error}
              </div>
            )}

            {/* Table Name */}
            <div className='flex flex-col gap-[6px]'>
              <Label htmlFor='tableName' className='text-[12px] font-medium'>
                Table Name*
              </Label>
              <Input
                id='tableName'
                value={tableName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTableName(e.target.value)}
                placeholder='customers, orders, products'
                className='h-[36px]'
                required
              />
              <p className='text-[11px] text-[var(--text-muted)]'>
                Use lowercase with underscores (e.g., customer_orders)
              </p>
            </div>

            {/* Description */}
            <div className='flex flex-col gap-[6px]'>
              <Label htmlFor='description' className='text-[12px] font-medium'>
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
            <div className='flex flex-col gap-[12px]'>
              <div className='flex items-center justify-between'>
                <Label className='text-[12px] font-medium'>Columns*</Label>
                <Button
                  type='button'
                  size='sm'
                  variant='default'
                  onClick={handleAddColumn}
                  className='h-[28px] rounded-[6px] px-[10px] text-[12px]'
                >
                  <Plus className='mr-[4px] h-[12px] w-[12px]' />
                  Add Column
                </Button>
              </div>

              {/* Column Headers */}
              <div className='flex items-center gap-[8px] text-[11px] font-medium text-[var(--text-muted)]'>
                <div className='flex-1'>Name</div>
                <div className='w-[120px]'>Type</div>
                <div className='w-[70px] text-center'>Required</div>
                <div className='w-[32px]' />
              </div>

              {/* Column Rows */}
              <div className='flex flex-col gap-[8px]'>
                {columns.map((column, index) => (
                  <div key={index} className='flex items-center gap-[8px]'>
                    {/* Column Name */}
                    <div className='flex-1'>
                      <Input
                        value={column.name}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          handleColumnChange(index, 'name', e.target.value)
                        }
                        placeholder='column_name'
                        className='h-[36px]'
                      />
                    </div>

                    {/* Column Type */}
                    <div className='w-[120px]'>
                      <Combobox
                        options={COLUMN_TYPES}
                        value={column.type}
                        selectedValue={column.type}
                        onChange={(value) =>
                          handleColumnChange(index, 'type', value as ColumnDefinition['type'])
                        }
                        placeholder='Type'
                        editable={false}
                        filterOptions={false}
                        size='sm'
                      />
                    </div>

                    {/* Required Checkbox */}
                    <div className='flex w-[70px] items-center justify-center'>
                      <Checkbox
                        checked={column.required}
                        onCheckedChange={(checked) =>
                          handleColumnChange(index, 'required', checked === true)
                        }
                      />
                    </div>

                    {/* Delete Button */}
                    <div className='w-[32px]'>
                      <Button
                        type='button'
                        size='sm'
                        variant='ghost'
                        onClick={() => handleRemoveColumn(index)}
                        disabled={columns.length === 1}
                        className='h-[32px] w-[32px] p-0 text-[var(--text-muted)] hover:text-[var(--text-error)]'
                      >
                        <Trash2 className='h-[14px] w-[14px]' />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </form>
        </ModalBody>
        <ModalFooter>
          <Button type='button' variant='default' onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type='button'
            variant='tertiary'
            onClick={handleSubmit}
            disabled={createTable.isPending}
          >
            {createTable.isPending ? 'Creating...' : 'Create Table'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
