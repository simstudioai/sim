'use client'

import { memo } from 'react'
import { useTranslations } from 'next-intl'
import { ChipConfirmModal } from '@/components/emcn'

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
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  return (
    <ChipConfirmModal
      open={isOpen}
      onOpenChange={onClose}
      srTitle={tI18n('delete_knowledge_base')}
      title={t('delete_knowledge_base')}
      text={
        knowledgeBaseName
          ? [
              'Are you sure you want to delete ',
              { text: knowledgeBaseName, bold: true },
              '? ',
              {
                text: 'All associated documents, chunks, and embeddings will be removed.',
                error: true,
              },
              ' You can restore it from Recently Deleted in Settings.',
            ]
          : [
              'Are you sure you want to delete this knowledge base? ',
              {
                text: 'All associated documents, chunks, and embeddings will be removed.',
                error: true,
              },
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
