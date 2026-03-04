'use client'

import { useTranslations } from 'next-intl'
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
export function DeleteKnowledgeBaseModal({
  isOpen,
  onClose,
  onConfirm,
  isDeleting,
  knowledgeBaseName,
}: DeleteKnowledgeBaseModalProps) {
  const t = useTranslations('knowledge')
  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent size='sm'>
        <ModalHeader>{t('modals.delete_title')}</ModalHeader>
        <ModalBody>
          <p className='text-[12px] text-[var(--text-secondary)]'>
            {knowledgeBaseName ? (
              <>
                {t('modals.delete_confirmation', { name: knowledgeBaseName })} {' '}
              </>
            ) : (
              t('modals.delete_confirmation_unnamed')
            )}
            <span className='text-[var(--text-error)]'>{t('modals.delete_warning')}</span>
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={onClose} disabled={isDeleting}>
            {t('buttons.cancel')}
          </Button>
          <Button variant='destructive' onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? t('buttons.deleting') : t('buttons.delete')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
