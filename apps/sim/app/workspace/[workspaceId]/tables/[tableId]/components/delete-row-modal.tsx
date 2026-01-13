'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { AlertCircle } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/emcn'

const logger = createLogger('DeleteRowModal')

interface DeleteRowModalProps {
  isOpen: boolean
  onClose: () => void
  tableId: string
  rowIds: string[]
  onSuccess: () => void
}

export function DeleteRowModal({
  isOpen,
  onClose,
  tableId,
  rowIds,
  onSuccess,
}: DeleteRowModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [error, setError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    setError(null)
    setIsDeleting(true)

    try {
      // Delete rows one by one or in batch
      if (rowIds.length === 1) {
        const res = await fetch(`/api/table/${tableId}/rows/${rowIds[0]}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId }),
        })

        if (!res.ok) {
          const result = await res.json()
          throw new Error(result.error || 'Failed to delete row')
        }
      } else {
        // Batch delete - you might want to implement a batch delete endpoint
        await Promise.all(
          rowIds.map((rowId) =>
            fetch(`/api/table/${tableId}/rows/${rowId}`, {
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
      setIsDeleting(false)
    }
  }

  const handleClose = () => {
    setError(null)
    onClose()
  }

  return (
    <Modal open={isOpen} onOpenChange={handleClose}>
      <ModalContent className='w-[480px]'>
        <ModalHeader>
          <div className='flex items-center gap-[10px]'>
            <div className='flex h-[36px] w-[36px] items-center justify-center rounded-[8px] bg-[var(--bg-error)] text-[var(--text-error)]'>
              <AlertCircle className='h-[18px] w-[18px]' />
            </div>
            <h2 className='font-semibold text-[16px]'>
              Delete {rowIds.length === 1 ? 'Row' : `${rowIds.length} Rows`}
            </h2>
          </div>
        </ModalHeader>
        <ModalBody>
          <div className='flex flex-col gap-[16px]'>
            {error && (
              <div className='rounded-[8px] border border-[var(--status-error-border)] bg-[var(--status-error-bg)] px-[14px] py-[12px] text-[13px] text-[var(--status-error-text)]'>
                {error}
              </div>
            )}

            <p className='text-[14px] text-[var(--text-secondary)]'>
              Are you sure you want to delete {rowIds.length === 1 ? 'this row' : 'these rows'}?
              This action cannot be undone.
            </p>
          </div>
        </ModalBody>
        <ModalFooter className='gap-[10px]'>
          <Button
            type='button'
            variant='default'
            onClick={handleClose}
            className='min-w-[90px]'
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            type='button'
            variant='error'
            onClick={handleDelete}
            disabled={isDeleting}
            className='min-w-[120px]'
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
