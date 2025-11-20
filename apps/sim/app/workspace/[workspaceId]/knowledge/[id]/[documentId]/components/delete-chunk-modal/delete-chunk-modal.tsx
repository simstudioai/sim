'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Button,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/emcn'
import { Trash } from '@/components/emcn/icons/trash'
import { createLogger } from '@/lib/logs/console/logger'
import type { ChunkData } from '@/stores/knowledge/store'

const logger = createLogger('DeleteChunkModal')

interface DeleteChunkModalProps {
  chunk: ChunkData | null
  knowledgeBaseId: string
  documentId: string
  isOpen: boolean
  onClose: () => void
  onChunkDeleted?: () => void
}

export function DeleteChunkModal({
  chunk,
  knowledgeBaseId,
  documentId,
  isOpen,
  onClose,
  onChunkDeleted,
}: DeleteChunkModalProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDeleteChunk = async () => {
    if (!chunk || isDeleting) return

    try {
      setIsDeleting(true)

      const response = await fetch(
        `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/chunks/${chunk.id}`,
        {
          method: 'DELETE',
        }
      )

      if (!response.ok) {
        throw new Error('Failed to delete chunk')
      }

      const result = await response.json()

      if (result.success) {
        logger.info('Chunk deleted successfully:', chunk.id)
        if (onChunkDeleted) {
          onChunkDeleted()
        }
        onClose()
      } else {
        throw new Error(result.error || 'Failed to delete chunk')
      }
    } catch (err) {
      logger.error('Error deleting chunk:', err)
      // You might want to show an error state here
    } finally {
      setIsDeleting(false)
    }
  }

  if (!chunk) return null

  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Delete Chunk</ModalTitle>
          <ModalDescription>
            Are you sure you want to delete this chunk?{' '}
            <span className='text-[var(--text-error)] dark:text-[var(--text-error)]'>
              This action cannot be undone.
            </span>
          </ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <Button
            variant='outline'
            disabled={isDeleting}
            onClick={onClose}
            className='h-[32px] px-[12px]'
          >
            Cancel
          </Button>
          <Button
            onClick={handleDeleteChunk}
            disabled={isDeleting}
            className='h-[32px] bg-[var(--text-error)] px-[12px] text-[var(--white)] hover:bg-[var(--text-error)] hover:text-[var(--white)] dark:bg-[var(--text-error)] dark:text-[var(--white)] hover:dark:bg-[var(--text-error)] dark:hover:text-[var(--white)]'
          >
            {isDeleting ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Deleting...
              </>
            ) : (
              <>
                <Trash className='mr-2 h-4 w-4' />
                Delete
              </>
            )}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
