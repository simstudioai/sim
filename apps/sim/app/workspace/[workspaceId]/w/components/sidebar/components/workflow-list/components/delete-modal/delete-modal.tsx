'use client'

import { useState } from 'react'
import { ChipConfirmModal, type ChipConfirmTextSegment, ChipModalField } from '@sim/emcn'
import type { PinnedAppDeleteConflict } from '@/app/workspace/[workspaceId]/w/hooks/use-delete-workflow'

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
  /** Apps whose callable releases prevent the selected workflow from being deleted. */
  blockedApps?: PinnedAppDeleteConflict[]
  workspaceId?: string
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
  blockedApps = [],
  workspaceId,
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

  const buildDescriptionSegments = (): ChipConfirmTextSegment[] => {
    if (itemType === 'workflow') {
      if (blockedApps.length > 0) {
        return [
          {
            text: 'This workflow cannot be deleted while published Full-stack Apps retain its deployment version.',
            error: true,
          },
          ' Revoke or detach the listed App releases first.',
        ]
      }
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
        text: 'This will permanently remove all conversation history.',
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
        restorableTypes.has(itemType)
          ? 'You can restore it from Recently deleted in Settings.'
          : 'This action cannot be undone.',
      ]}
      confirm={{
        label: blockedApps.length > 0 ? 'Blocked by Apps' : 'Delete',
        onClick: onConfirm,
        pending: isDeleting,
        pendingLabel: 'Deleting...',
        disabled: !isConfirmed || blockedApps.length > 0,
      }}
    >
      {blockedApps.length > 0 && workspaceId ? (
        <div className='space-y-1 px-2 text-[var(--text-secondary)] text-xs'>
          {blockedApps.map((app) => (
            <a
              key={app.projectId}
              href={`/workspace/${workspaceId}/apps/${app.projectId}`}
              target='_blank'
              rel='noreferrer'
              className='block underline underline-offset-2'
            >
              Open {app.name || app.publicId}
            </a>
          ))}
        </div>
      ) : null}
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
