'use client'

import { useState } from 'react'
import { ChipConfirmModal, ChipModalField } from '@/components/emcn'

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
    title = isMultiple ? 'Delete workflows' : 'Delete workflow'
  } else if (itemType === 'folder') {
    title = isMultiple ? 'Delete folders' : 'Delete folder'
  } else if (itemType === 'task') {
    title = isMultiple ? 'Delete chats' : 'Delete chat'
  } else if (itemType === 'mixed') {
    title = 'Delete items'
  } else {
    title = 'Delete workspace'
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
              {displayNames.length} chats
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
          Are you sure you want to delete this chat?{' '}
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
    <ChipConfirmModal
      open={isOpen}
      onOpenChange={handleClose}
      srTitle={title}
      title={title}
      description={
        <>
          {renderDescription()}{' '}
          {restorableTypes.has(itemType)
            ? 'You can restore it from Recently deleted in Settings.'
            : 'This action cannot be undone.'}
        </>
      }
      confirm={{
        label: 'Delete',
        onClick: onConfirm,
        pending: isDeleting,
        pendingLabel: 'Deleting...',
        disabled: !isConfirmed,
      }}
    >
      {isWorkspace && workspaceName && (
        <ChipModalField
          type='input'
          title={
            <span>
              Type&nbsp;
              <span className='font-medium text-[var(--text-primary)]'>{workspaceName}</span>
              &nbsp;to confirm
            </span>
          }
          value={confirmationText}
          onChange={setConfirmationText}
          placeholder={workspaceName}
        />
      )}
    </ChipConfirmModal>
  )
}
