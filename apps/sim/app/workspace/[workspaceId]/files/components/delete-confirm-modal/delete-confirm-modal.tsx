'use client'

import { memo } from 'react'
import { ChipConfirmModal } from '@sim/emcn'

interface DeleteConfirmModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileName?: string
  fileCount: number
  folderCount: number
  onDelete: () => void
  isPending: boolean
}

export const DeleteConfirmModal = memo(function DeleteConfirmModal({
  open,
  onOpenChange,
  fileName,
  fileCount,
  folderCount,
  onDelete,
  isPending,
}: DeleteConfirmModalProps) {
  const totalCount = fileCount + folderCount
  const hasFolders = folderCount > 0
  const title = totalCount > 1 ? 'Delete Items' : hasFolders ? 'Delete Folder' : 'Delete File'
  const consequence = hasFolders
    ? totalCount > 1
      ? 'This will also delete files and folders inside any selected folders.'
      : 'This will also delete files and folders inside it.'
    : totalCount > 1
      ? 'You can restore them from Recently Deleted in Settings.'
      : 'You can restore it from Recently Deleted in Settings.'

  return (
    <ChipConfirmModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={title}
      title={title}
      text={[
        'Are you sure you want to delete ',
        fileName
          ? { text: fileName, bold: true }
          : `${totalCount} item${totalCount === 1 ? '' : 's'}`,
        `? ${consequence}`,
      ]}
      confirm={{
        label: 'Delete',
        onClick: onDelete,
        pending: isPending,
        pendingLabel: 'Deleting...',
      }}
    />
  )
})
