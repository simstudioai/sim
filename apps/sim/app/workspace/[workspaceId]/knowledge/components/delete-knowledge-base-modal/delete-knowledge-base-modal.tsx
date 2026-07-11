'use client'

import { memo } from 'react'
import { ChipConfirmModal } from '@sim/emcn'

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
   * Name of the knowledge base (or folder) being deleted
   */
  knowledgeBaseName?: string
  /**
   * 'base' (default) deletes a single knowledge base; 'folder' deletes a
   * knowledge base folder, which cascades to the bases inside it.
   */
  kind?: 'base' | 'folder'
}

/**
 * Delete confirmation modal for knowledge base items and knowledge base
 * folders. Displays a warning message and confirmation buttons.
 */
export const DeleteKnowledgeBaseModal = memo(function DeleteKnowledgeBaseModal({
  isOpen,
  onClose,
  onConfirm,
  isDeleting,
  knowledgeBaseName,
  kind = 'base',
}: DeleteKnowledgeBaseModalProps) {
  const isFolder = kind === 'folder'
  const title = isFolder ? 'Delete Folder' : 'Delete Knowledge Base'
  const consequence = isFolder
    ? 'All bases (and their documents, chunks, and embeddings) inside it will be removed.'
    : 'All associated documents, chunks, and embeddings will be removed.'
  const subject = isFolder ? 'this folder' : 'this knowledge base'

  return (
    <ChipConfirmModal
      open={isOpen}
      onOpenChange={onClose}
      srTitle={title}
      title={title}
      text={
        knowledgeBaseName
          ? [
              'Are you sure you want to delete ',
              { text: knowledgeBaseName, bold: true },
              '? ',
              { text: consequence, error: true },
              ' You can restore it from Recently Deleted in Settings.',
            ]
          : [
              `Are you sure you want to delete ${subject}? `,
              { text: consequence, error: true },
              ' You can restore it from Recently Deleted in Settings.',
            ]
      }
      confirm={{
        label: 'Delete',
        onClick: onConfirm,
        pending: isDeleting,
        pendingLabel: 'Deleting...',
      }}
    />
  )
})
