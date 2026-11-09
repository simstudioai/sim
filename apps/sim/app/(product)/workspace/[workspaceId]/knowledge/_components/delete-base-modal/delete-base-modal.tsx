'use client'

import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { type KnowledgeBaseData, useDeleteKnowledgeBase } from '@/platform/lib/data/knowledge'

interface DeleteBaseModalProps {
  /** The base to delete; the dialog is open while it is set. */
  base: Pick<KnowledgeBaseData, 'id' | 'name'> | null
  onClose: () => void
  /** Runs once the base is gone, such as leaving its page. */
  onDeleted?: () => void
}

/** Asks before a knowledge base and everything indexed in it is deleted. */
export function DeleteBaseModal({ base, onClose, onDeleted }: DeleteBaseModalProps) {
  const deleteBase = useDeleteKnowledgeBase()
  return (
    <ConfirmDialog
      target={base}
      onClose={onClose}
      title='Delete knowledge base'
      description={(target) =>
        `Are you sure you want to delete ${target.name}? All associated documents, chunks and embeddings will be removed. You can restore it from Recently Deleted in Settings.`
      }
      confirmLabel='Delete'
      pendingLabel='Deleting…'
      onConfirm={async (target) => {
        await deleteBase.mutateAsync({ knowledgeBaseId: target.id })
        onDeleted?.()
      }}
    />
  )
}
