'use client'

import { Chip, ChipModal, ChipModalBody, ChipModalFooter, ChipModalHeader } from '@/components/emcn'
import type { ChunkData } from '@/lib/knowledge/types'
import { useDeleteChunk } from '@/hooks/queries/kb/knowledge'

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
  const { mutate: deleteChunk, isPending: isDeleting } = useDeleteChunk()

  const handleDeleteChunk = () => {
    if (!chunk || isDeleting) return

    deleteChunk({ knowledgeBaseId, documentId, chunkId: chunk.id }, { onSuccess: onClose })
  }

  if (!chunk) return null

  return (
    <ChipModal open={isOpen} onOpenChange={onClose} srTitle='Delete Chunk'>
      <ChipModalHeader onClose={onClose} showDivider={false}>
        Delete Chunk
      </ChipModalHeader>
      <ChipModalBody>
        <p className='px-2 text-[var(--text-secondary)] text-sm'>
          Are you sure you want to delete this chunk? This action cannot be undone.
        </p>
      </ChipModalBody>
      <ChipModalFooter>
        <Chip variant='filled' flush disabled={isDeleting} onClick={onClose}>
          Cancel
        </Chip>
        <Chip variant='destructive' flush onClick={handleDeleteChunk} disabled={isDeleting}>
          {isDeleting ? <>Deleting…</> : <>Delete</>}
        </Chip>
      </ChipModalFooter>
    </ChipModal>
  )
}
