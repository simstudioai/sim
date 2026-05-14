'use client'

import { memo } from 'react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'

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
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='sm'>
        <ModalHeader>{title}</ModalHeader>
        <ModalBody>
          <ModalDescription className='text-[var(--text-secondary)]'>
            Are you sure you want to delete{' '}
            {fileName ? (
              <span className='font-medium text-[var(--text-primary)]'>{fileName}</span>
            ) : (
              `${totalCount} item${totalCount === 1 ? '' : 's'}`
            )}
            ? {consequence}
          </ModalDescription>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant='destructive' onClick={onDelete} disabled={isPending}>
            {isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
})
