'use client'

import { useState } from 'react'
import { ChipConfirmModal, type ChipConfirmTextSegment, ChipModalField } from '@sim/emcn'

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

/** Item types that land in Recently Deleted and can be restored from Settings. */
const RESTORABLE_TYPES = new Set<string>(['workflow', 'folder', 'mixed', 'task'])

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

  const buildDescriptionSegments = (): ChipConfirmTextSegment[] => {
    if (itemType === 'workflow') {
      const warning = {
        text: 'All associated blocks, executions, and configuration will be removed.',
        error: true,
      }
      if (isMultiple) {
        return [
          'Are you sure you want to delete ',
          { text: displayNames.join(', '), bold: true },
          '? ',
          warning,
        ]
      }
      if (isSingle && displayNames.length > 0) {
        return [
          'Are you sure you want to delete ',
          { text: displayNames[0], bold: true },
          '? ',
          warning,
        ]
      }
      return ['Are you sure you want to delete this workflow? ', warning]
    }

    if (itemType === 'folder') {
      if (isMultiple) {
        return [
          'Are you sure you want to delete ',
          { text: displayNames.join(', '), bold: true },
          '? ',
          {
            text: 'All workflows and contents within these folders will be archived.',
            error: true,
          },
        ]
      }
      const warning = {
        text: 'All associated workflows and contents will be archived.',
        error: true,
      }
      if (isSingle && displayNames.length > 0) {
        return [
          'Are you sure you want to delete ',
          { text: displayNames[0], bold: true },
          '? ',
          warning,
        ]
      }
      return ['Are you sure you want to delete this folder? ', warning]
    }

    if (itemType === 'task') {
      const warning = {
        text: 'The chat and its conversation history will be archived.',
        error: true,
      }
      if (isMultiple) {
        return [
          'Are you sure you want to delete ',
          { text: `${displayNames.length} chats`, bold: true },
          '? ',
          warning,
        ]
      }
      if (isSingle && displayNames.length > 0) {
        return [
          'Are you sure you want to delete ',
          { text: displayNames[0], bold: true },
          '? ',
          warning,
        ]
      }
      return ['Are you sure you want to delete this chat? ', warning]
    }

    if (itemType === 'mixed') {
      const warning = {
        text: 'All selected workflows and folders, including their contents, will be archived.',
        error: true,
      }
      if (displayNames.length > 0) {
        return [
          'Are you sure you want to delete ',
          { text: displayNames.join(', '), bold: true },
          '? ',
          warning,
        ]
      }
      return ['Are you sure you want to delete the selected items? ', warning]
    }

    const workspaceWarning = {
      text: 'This will permanently remove all associated workflows, tables, files, logs, and knowledge bases.',
      error: true,
    }
    if (isSingle && displayNames.length > 0) {
      return [
        'Are you sure you want to delete ',
        { text: displayNames[0], bold: true },
        '? ',
        workspaceWarning,
      ]
    }
    return ['Are you sure you want to delete this workspace? ', workspaceWarning]
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
      text={[
        ...buildDescriptionSegments(),
        ' ',
        RESTORABLE_TYPES.has(itemType)
          ? 'You can restore it from Recently deleted in Settings.'
          : 'This action cannot be undone.',
      ]}
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
