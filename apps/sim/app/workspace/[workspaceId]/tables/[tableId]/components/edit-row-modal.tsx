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
import type { TableSchema } from '@/lib/table'

const logger = createLogger('EditRowModal')

interface TableRowData {
  id: string
  data: Record<string, any>
  createdAt: string
  updatedAt: string
}

interface EditRowModalProps {
  isOpen: boolean
  onClose: () => void
  table: any
  row: TableRowData
  onSuccess: () => void
}

export function EditRowModal({ isOpen, onClose, table, row, onSuccess }: EditRowModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const schema = table?.schema as TableSchema | undefined
  const columns = schema?.columns || []

  const [rowData, setRowData] = useState<Record<string, any>>(row.data)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setRowData(row.data)
  }, [row.data])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      // Clean up data
      const cleanData: Record<string, any> = {}
      columns.forEach((col) => {
        const value = rowData[col.name]
        if (col.type === 'number') {
          cleanData[col.name] = value === '' ? null : Number(value)
        } else if (col.type === 'json') {
          try {
            cleanData[col.name] = typeof value === 'string' ? JSON.parse(value) : value
          } catch {
            throw new Error(`Invalid JSON for field: ${col.name}`)
          }
        } else if (col.type === 'boolean') {
          cleanData[col.name] = Boolean(value)
        } else {
          cleanData[col.name] = value || null
        }
      })

      const res = await fetch(`/api/table/${table?.id}/rows/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          data: cleanData,
        }),
      })

      const result = await res.json()

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

  const handleClose = () => {
    setError(null)
    onClose()
  }

  const formatValueForInput = (value: any, type: string): string => {
    if (value === null || value === undefined) return ''
    if (type === 'json') {
      return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    }
    if (type === 'date' && value) {
      try {
        const date = new Date(value)
        return date.toISOString().split('T')[0]
      } catch {
        return String(value)
      }
    }
    return String(value)
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
              <div key={column.name} className='flex flex-col gap-[8px]'>
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
                      checked={Boolean(rowData[column.name])}
                      onCheckedChange={(checked) =>
                        setRowData((prev) => ({ ...prev, [column.name]: checked === true }))
                      }
                    />
                    <Label
                      htmlFor={column.name}
                      className='font-normal text-[13px] text-[var(--text-tertiary)]'
                    >
                      {rowData[column.name] ? 'True' : 'False'}
                    </Label>
                  </div>
                ) : column.type === 'json' ? (
                  <Textarea
                    id={column.name}
                    value={formatValueForInput(rowData[column.name], column.type)}
                    onChange={(e) =>
                      setRowData((prev) => ({ ...prev, [column.name]: e.target.value }))
                    }
                    placeholder='{"key": "value"}'
                    rows={4}
                    className='font-mono text-[12px]'
                    required={column.required}
                  />
                ) : (
                  <Input
                    id={column.name}
                    type={
                      column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'
                    }
                    value={formatValueForInput(rowData[column.name], column.type)}
                    onChange={(e) =>
                      setRowData((prev) => ({ ...prev, [column.name]: e.target.value }))
                    }
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
