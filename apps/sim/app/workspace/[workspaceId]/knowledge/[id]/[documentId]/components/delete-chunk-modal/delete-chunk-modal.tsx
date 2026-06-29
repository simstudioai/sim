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
  const tI18n = useTranslations('auto')
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
      srTitle={tI18n('delete_chunk')}
      title={t('delete_chunk')}
      text={tI18n('are_you_sure_you_want_to')}
      confirm={{
        label: 'Delete',
        onClick: handleDeleteChunk,
        pending: isDeleting,
        pendingLabel: 'Deleting...',
      }}
    />
  )
}
