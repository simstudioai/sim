'use client'

import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/emcn'
import { Button } from '@/components/ui/button'

interface DeleteModalProps {
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
   * Type of item being deleted
   */
  itemType: 'workflow' | 'folder'
  /**
   * Name of the item being deleted (optional, for display)
   */
  itemName?: string
}

/**
 * Reusable delete confirmation modal for workflow and folder items.
 * Displays a warning message and confirmation buttons.
 *
 * @param props - Component props
 * @returns Delete confirmation modal
 */
export function DeleteModal({
  isOpen,
  onClose,
  onConfirm,
  isDeleting,
  itemType,
  itemName,
}: DeleteModalProps) {
  const title = itemType === 'workflow' ? 'Delete workflow?' : 'Delete folder?'

  const description =
    itemType === 'workflow'
      ? 'Deleting this workflow will permanently remove all associated blocks, executions, and configuration.'
      : 'Deleting this folder will permanently remove all associated workflows, logs, and knowledge bases.'

  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <ModalDescription>
            {description}{' '}
            <span className='text-[#EF4444] dark:text-[#EF4444]'>
              This action cannot be undone.
            </span>
          </ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <Button
            className='h-[32px] px-[12px]'
            variant='outline'
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            className='h-[32px] bg-[#EF4444] px-[12px] text-[#FFFFFF] hover:bg-[#EF4444] hover:text-[#FFFFFF] dark:bg-[#EF4444] dark:text-[#FFFFFF] hover:dark:bg-[#EF4444] dark:hover:text-[#FFFFFF]'
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
