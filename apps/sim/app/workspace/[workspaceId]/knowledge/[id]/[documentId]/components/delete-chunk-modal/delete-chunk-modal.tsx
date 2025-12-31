'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/emcn'
import type { ChunkData } from '@/lib/knowledge/types'
import { knowledgeKeys } from '@/hooks/queries/knowledge'

const logger = createLogger('DeleteChunkModal')

interface DeleteChunkModalProps {
  chunk: ChunkData | null
  knowledgeBaseId: string
  documentId: string
  isOpen: boolean
  onClose: () => void
}

export function DeleteChunkModal({
  chunk,
  knowledgeBaseId,
  documentId,
  isOpen,
  onClose,
}: DeleteChunkModalProps) {
  const queryClient = useQueryClient()
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

        await queryClient.invalidateQueries({
          queryKey: knowledgeKeys.detail(knowledgeBaseId),
        })

        onClose()
      } else {
        throw new Error(result.error || 'Failed to delete chunk')
      }
    } catch (err) {
      logger.error('Error deleting chunk:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  if (!chunk) return null

  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent size='sm'>
        <ModalHeader>Delete Chunk</ModalHeader>
        <ModalBody>
          <p className='text-[12px] text-[var(--text-secondary)]'>
            Are you sure you want to delete this chunk?{' '}
            <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant='active' disabled={isDeleting} onClick={onClose}>
            Cancel
          </Button>
          <Button variant='destructive' onClick={handleDeleteChunk} disabled={isDeleting}>
            {isDeleting ? <>Deleting...</> : <>Delete</>}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
