'use client'

import { memo } from 'react'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/emcn'

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
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent size='sm'>
        <ModalHeader>Delete Knowledge Base</ModalHeader>
        <ModalBody>
          <p className='text-[var(--text-secondary)]'>
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
            <span className='text-[var(--text-tertiary)]'>
              You can restore it from Recently Deleted in Settings.
            </span>
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={onClose} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant='destructive' onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
})
