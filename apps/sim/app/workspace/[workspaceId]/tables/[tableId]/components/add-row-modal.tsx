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

const logger = createLogger('AddRowModal')

interface AddRowModalProps {
  isOpen: boolean
  onClose: () => void
  table: any
  onSuccess: () => void
}

export function AddRowModal({ isOpen, onClose, table, onSuccess }: AddRowModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const schema = table?.schema as TableSchema | undefined
  const columns = schema?.columns || []

  const [rowData, setRowData] = useState<Record<string, any>>({})
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen && columns.length > 0) {
      const initial: Record<string, any> = {}
      columns.forEach((col) => {
        if (col.type === 'boolean') {
          initial[col.name] = false
        } else {
          initial[col.name] = ''
        }
      })
      setRowData(initial)
    }
  }, [isOpen, columns])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      // Clean up data - remove empty optional fields
      const cleanData: Record<string, any> = {}
      columns.forEach((col) => {
        const value = rowData[col.name]
        if (col.required || (value !== '' && value !== null && value !== undefined)) {
          if (col.type === 'number') {
            cleanData[col.name] = value === '' ? null : Number(value)
          } else if (col.type === 'json') {
            try {
              cleanData[col.name] = value === '' ? null : JSON.parse(value)
            } catch {
              throw new Error(`Invalid JSON for field: ${col.name}`)
            }
          } else if (col.type === 'boolean') {
            cleanData[col.name] = Boolean(value)
          } else {
            cleanData[col.name] = value || null
          }
        }
      })

      const res = await fetch(`/api/table/${table?.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          data: cleanData,
        }),
      })

      const result = await res.json()

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
                      checked={rowData[column.name] ?? false}
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
                    value={rowData[column.name] ?? ''}
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
                    value={rowData[column.name] ?? ''}
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
            {isSubmitting ? 'Adding...' : 'Add Row'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
