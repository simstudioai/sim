'use client'

import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/emcn'

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
   * - 'mixed' is used when both workflows and folders are selected
   */
  itemType: 'workflow' | 'folder' | 'workspace' | 'mixed' | 'task'
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
    title = isMultiple ? 'Delete Workflows' : 'Delete Workflow'
  } else if (itemType === 'folder') {
    title = isMultiple ? 'Delete Folders' : 'Delete Folder'
  } else if (itemType === 'task') {
    title = isMultiple ? 'Delete Tasks' : 'Delete Task'
  } else if (itemType === 'mixed') {
    title = 'Delete Items'
  } else {
    title = 'Delete Workspace'
  }

  const restorableTypes = new Set<string>(['workflow'])

  const renderDescription = () => {
    if (itemType === 'workflow') {
      if (isMultiple) {
        return (
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>
              {displayNames.join(', ')}
            </span>
            ? All associated blocks, executions, and configuration will be removed.
          </>
        )
      }
      if (isSingle && displayNames.length > 0) {
        return (
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>{displayNames[0]}</span>? All
            associated blocks, executions, and configuration will be removed.
          </>
        )
      }
      return 'Are you sure you want to delete this workflow? All associated blocks, executions, and configuration will be removed.'
    }

    if (itemType === 'folder') {
      if (isMultiple) {
        return (
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>
              {displayNames.join(', ')}
            </span>
            ? This will permanently remove all workflows, logs, and knowledge bases within these
            folders.
          </>
        )
      }
      if (isSingle && displayNames.length > 0) {
        return (
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>{displayNames[0]}</span>? This
            will permanently remove all associated workflows, logs, and knowledge bases.
          </>
        )
      }
      return 'Are you sure you want to delete this folder? This will permanently remove all associated workflows, logs, and knowledge bases.'
    }

    if (itemType === 'task') {
      if (isMultiple) {
        return (
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>
              {displayNames.length} tasks
            </span>
            ? This will permanently remove all conversation history.
          </>
        )
      }
      if (isSingle && displayNames.length > 0) {
        return (
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>{displayNames[0]}</span>? This
            will permanently remove all conversation history.
          </>
        )
      }
      return 'Are you sure you want to delete this task? This will permanently remove all conversation history.'
    }

    if (itemType === 'mixed') {
      if (displayNames.length > 0) {
        return (
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>
              {displayNames.join(', ')}
            </span>
            ? This will permanently remove all selected workflows and folders, including their
            contents.
          </>
        )
      }
      return 'Are you sure you want to delete the selected items? This will permanently remove all selected workflows and folders, including their contents.'
    }

    // workspace type
    if (isSingle && displayNames.length > 0) {
      return (
        <>
          Are you sure you want to delete{' '}
          <span className='font-medium text-[var(--text-primary)]'>{displayNames[0]}</span>? This
          will permanently remove all associated workflows, folders, logs, and knowledge bases.
        </>
      )
    }
    return 'Are you sure you want to delete this workspace? This will permanently remove all associated workflows, folders, logs, and knowledge bases.'
  }

  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent size='sm'>
        <ModalHeader>{title}</ModalHeader>
        <ModalBody>
          <p className='text-[var(--text-secondary)]'>
            {renderDescription()}{' '}
            {restorableTypes.has(itemType) ? (
              <span className='text-[var(--text-tertiary)]'>
                You can restore it from Recently Deleted in Settings.
              </span>
            ) : (
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            )}
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
}
