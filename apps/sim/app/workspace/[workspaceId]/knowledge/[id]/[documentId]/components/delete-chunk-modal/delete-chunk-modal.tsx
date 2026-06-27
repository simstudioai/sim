'use client'

import { useTranslations } from 'next-intl'
import { ChipConfirmModal } from '@/components/emcn'
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
  const t = useTranslations('auto')
  const { mutate: deleteChunk, isPending: isDeleting } = useDeleteChunk()

  const handleDeleteChunk = () => {
    if (!chunk || isDeleting) return

    deleteChunk({ knowledgeBaseId, documentId, chunkId: chunk.id }, { onSuccess: onClose })
  }

  if (!chunk) return null

  return (
    <ChipConfirmModal
      open={isOpen}
      onOpenChange={onClose}
      srTitle='Delete Chunk'
      title={t('delete_chunk')}
      text='Are you sure you want to delete this chunk? This action cannot be undone.'
      confirm={{
        label: 'Delete',
        onClick: handleDeleteChunk,
        pending: isDeleting,
        pendingLabel: 'Deleting...',
      }}
    />
  )
}
