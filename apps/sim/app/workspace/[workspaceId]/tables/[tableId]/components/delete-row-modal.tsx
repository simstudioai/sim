'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { AlertCircle } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/emcn'

const logger = createLogger('DeleteRowModal')

/**
 * Props for the DeleteRowModal component.
 */
interface DeleteRowModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when the modal should close */
  onClose: () => void
  /** ID of the table containing the rows */
  tableId: string
  /** Array of row IDs to delete */
  rowIds: string[]
  /** Callback when deletion is successful */
  onSuccess: () => void
}

/**
 * Modal component for confirming row deletion.
 *
 * @remarks
 * Supports both single row and batch deletion. Shows a confirmation
 * dialog before performing the delete operation.
 *
 * @example
 * ```tsx
 * <DeleteRowModal
 *   isOpen={isDeleting}
 *   onClose={() => setIsDeleting(false)}
 *   tableId="tbl_123"
 *   rowIds={selectedRowIds}
 *   onSuccess={() => refetchRows()}
 * />
 * ```
 */
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

  /**
   * Handles the delete operation.
   */
  const handleDelete = async () => {
    setError(null)
    setIsDeleting(true)

    try {
      if (rowIds.length === 1) {
        // Single row deletion
        const res = await fetch(`/api/table/${tableId}/rows/${rowIds[0]}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId }),
        })

        if (!res.ok) {
          const result: { error?: string } = await res.json()
          throw new Error(result.error || 'Failed to delete row')
        }
      } else {
        // Batch deletion - delete rows in parallel
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

  /**
   * Handles modal close and resets state.
   */
  const handleClose = () => {
    setError(null)
    onClose()
  }

  const isSingleRow = rowIds.length === 1

  return (
    <Modal open={isOpen} onOpenChange={handleClose}>
      <ModalContent className='w-[480px]'>
        <ModalHeader>
          <div className='flex items-center gap-[10px]'>
            <div className='flex h-[36px] w-[36px] items-center justify-center rounded-[8px] bg-[var(--bg-error)] text-[var(--text-error)]'>
              <AlertCircle className='h-[18px] w-[18px]' />
            </div>
            <h2 className='font-semibold text-[16px]'>
              Delete {isSingleRow ? 'Row' : `${rowIds.length} Rows`}
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
              Are you sure you want to delete {isSingleRow ? 'this row' : 'these rows'}? This action
              cannot be undone.
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
