'use client'

import { memo } from 'react'
import { Chip, ChipModal, ChipModalBody, ChipModalFooter, ChipModalHeader } from '@/components/emcn'

interface DeleteKnowledgeBaseModalProps {
  /**
   * Whether the modal is open
   */
  isOpen: boolean
  /**
   * Callback when modal should close
   */
  onClose: () => void
  /**
   * Callback when delete is confirmed
   */
  onConfirm: () => void
  /**
   * Whether the delete operation is in progress
   */
  isDeleting: boolean
  /**
   * Name of the knowledge base being deleted
   */
  knowledgeBaseName?: string
}

/**
 * Delete confirmation modal for knowledge base items.
 * Displays a warning message and confirmation buttons.
 */
export const DeleteKnowledgeBaseModal = memo(function DeleteKnowledgeBaseModal({
  isOpen,
  onClose,
  onConfirm,
  isDeleting,
  knowledgeBaseName,
}: DeleteKnowledgeBaseModalProps) {
  return (
    <ChipModal open={isOpen} onOpenChange={onClose} srTitle='Delete Knowledge Base'>
      <ChipModalHeader onClose={onClose} showDivider={false}>
        Delete Knowledge Base
      </ChipModalHeader>
      <ChipModalBody>
        <p className='px-2 text-[var(--text-secondary)] text-sm'>
          {knowledgeBaseName ? (
            <>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>{knowledgeBaseName}</span>?
              <span className='text-[var(--text-error)]'>
                All associated documents, chunks, and embeddings will be removed.
              </span>
            </>
          ) : (
            <>
              Are you sure you want to delete this knowledge base?{' '}
              <span className='text-[var(--text-error)]'>
                All associated documents, chunks, and embeddings will be removed.
              </span>
            </>
          )}{' '}
          You can restore it from Recently Deleted in Settings.
        </p>
      </ChipModalBody>
      <ChipModalFooter>
        <Chip flush onClick={onClose} disabled={isDeleting}>
          Cancel
        </Chip>
        <Chip variant='destructive' flush onClick={onConfirm} disabled={isDeleting}>
          {isDeleting ? 'Deleting...' : 'Delete'}
        </Chip>
      </ChipModalFooter>
    </ChipModal>
  )
})
