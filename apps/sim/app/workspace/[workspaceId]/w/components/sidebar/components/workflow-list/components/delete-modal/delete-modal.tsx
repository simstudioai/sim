'use client'

import { useState } from 'react'
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
  const [confirmationText, setConfirmationText] = useState('')
  const [prevIsOpen, setPrevIsOpen] = useState(false)

  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen)
    if (isOpen) {
      setConfirmationText('')
    }
  }

  const isMultiple = Array.isArray(itemName) && itemName.length > 1
  const isSingle = !isMultiple

  const displayNames = Array.isArray(itemName) ? itemName : itemName ? [itemName] : []

  const isWorkspace = itemType === 'workspace'
  const workspaceName = isWorkspace && displayNames.length > 0 ? displayNames[0] : ''
  const isConfirmed = !isWorkspace || confirmationText === workspaceName

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

  const restorableTypes = new Set<string>(['workflow', 'folder', 'mixed'])

  const renderDescription = () => {
    if (itemType === 'workflow') {
      if (isMultiple) {
        return (
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>
              {displayNames.join(', ')}
            </span>
            ?{' '}
            <span className='text-[var(--text-error)]'>
              All associated blocks, executions, and configuration will be removed.
            </span>
          </>
        )
      }
      if (isSingle && displayNames.length > 0) {
        return (
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>{displayNames[0]}</span>?{' '}
            <span className='text-[var(--text-error)]'>
              All associated blocks, executions, and configuration will be removed.
            </span>
          </>
        )
      }
      return (
        <>
          Are you sure you want to delete this workflow?{' '}
          <span className='text-[var(--text-error)]'>
            All associated blocks, executions, and configuration will be removed.
          </span>
        </>
      )
    }

    if (itemType === 'folder') {
      if (isMultiple) {
        return (
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>
              {displayNames.join(', ')}
            </span>
            ?{' '}
            <span className='text-[var(--text-error)]'>
              All workflows and contents within these folders will be archived.
            </span>
          </>
        )
      }
      if (isSingle && displayNames.length > 0) {
        return (
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>{displayNames[0]}</span>?{' '}
            <span className='text-[var(--text-error)]'>
              All associated workflows and contents will be archived.
            </span>
          </>
        )
      }
      return (
        <>
          Are you sure you want to delete this folder?{' '}
          <span className='text-[var(--text-error)]'>
            All associated workflows and contents will be archived.
          </span>
        </>
      )
    }

    if (itemType === 'task') {
      if (isMultiple) {
        return (
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>
              {displayNames.length} tasks
            </span>
            ?{' '}
            <span className='text-[var(--text-error)]'>
              This will permanently remove all conversation history.
            </span>
          </>
        )
      }
      if (isSingle && displayNames.length > 0) {
        return (
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>{displayNames[0]}</span>?{' '}
            <span className='text-[var(--text-error)]'>
              This will permanently remove all conversation history.
            </span>
          </>
        )
      }
      return (
        <>
          Are you sure you want to delete this task?{' '}
          <span className='text-[var(--text-error)]'>
            This will permanently remove all conversation history.
          </span>
        </>
      )
    }

    if (itemType === 'mixed') {
      if (displayNames.length > 0) {
        return (
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>
              {displayNames.join(', ')}
            </span>
            ?{' '}
            <span className='text-[var(--text-error)]'>
              All selected workflows and folders, including their contents, will be archived.
            </span>
          </>
        )
      }
      return (
        <>
          Are you sure you want to delete the selected items?{' '}
          <span className='text-[var(--text-error)]'>
            All selected workflows and folders, including their contents, will be archived.
          </span>
        </>
      )
    }

    // workspace type
    if (isSingle && displayNames.length > 0) {
      return (
        <>
          Are you sure you want to delete{' '}
          <span className='font-medium text-[var(--text-primary)]'>{displayNames[0]}</span>?{' '}
          <span className='text-[var(--text-error)]'>
            This will permanently remove all associated workflows, tables, files, logs, and
            knowledge bases.
          </span>
        </>
      )
    }
    return (
      <>
        Are you sure you want to delete this workspace?{' '}
        <span className='text-[var(--text-error)]'>
          This will permanently remove all associated workflows, tables, files, logs, and knowledge
          bases.
        </span>
      </>
    )
  }

  const handleClose = () => {
    setConfirmationText('')
    onClose()
  }

  return (
    <Modal open={isOpen} onOpenChange={handleClose}>
      <ModalContent size='sm'>
        <ModalHeader>{title}</ModalHeader>
        <ModalBody>
          <p className='text-[var(--text-secondary)]'>
            {renderDescription()}{' '}
            {restorableTypes.has(itemType)
              ? 'You can restore it from Recently Deleted in Settings.'
              : 'This action cannot be undone.'}
          </p>
          {isWorkspace && workspaceName && (
            <div className='mt-3'>
              <label
                htmlFor='workspace-delete-confirm'
                className='mb-1.5 block text-[var(--text-secondary)] text-sm'
              >
                Type <span className='font-medium text-[var(--text-primary)]'>{workspaceName}</span>{' '}
                to confirm
              </label>
              <input
                id='workspace-delete-confirm'
                type='text'
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value)}
                className='w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-1)] focus:outline-none'
                placeholder={workspaceName}
              />
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={handleClose} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant='destructive' onClick={onConfirm} disabled={isDeleting || !isConfirmed}>
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
