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
  itemType: 'workflow' | 'folder' | 'workspace'
  /**
   * Name(s) of the item(s) being deleted (optional, for display)
   * Can be a single name or an array of names for multiple items
   */
  itemName?: string | string[]
}

/**
 * Reusable delete confirmation modal for workflow, folder, and workspace items.
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
  const isMultiple = Array.isArray(itemName) && itemName.length > 1
  const isSingle = !isMultiple

  const displayNames = Array.isArray(itemName) ? itemName : itemName ? [itemName] : []

  let title = ''
  if (itemType === 'workflow') {
    title = isMultiple ? 'Delete workflows?' : 'Delete workflow?'
  } else if (itemType === 'folder') {
    title = 'Delete folder?'
  } else {
    title = 'Delete workspace?'
  }

  let description = ''
  if (itemType === 'workflow') {
    if (isMultiple) {
      const workflowList = displayNames.join(', ')
      description = `Deleting ${workflowList} will permanently remove all associated blocks, executions, and configuration.`
    } else if (isSingle && displayNames.length > 0) {
      description = `Deleting ${displayNames[0]} will permanently remove all associated blocks, executions, and configuration.`
    } else {
      description =
        'Deleting this workflow will permanently remove all associated blocks, executions, and configuration.'
    }
  } else if (itemType === 'folder') {
    if (isSingle && displayNames.length > 0) {
      description = `Deleting ${displayNames[0]} will permanently remove all associated workflows, logs, and knowledge bases.`
    } else {
      description =
        'Deleting this folder will permanently remove all associated workflows, logs, and knowledge bases.'
    }
  } else {
    description =
      'Deleting this workspace will permanently remove all associated workflows, folders, logs, and knowledge bases.'
  }

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
