'use client'

import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { createLogger } from '@/lib/logs/console-logger'
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
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Chunk</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this chunk? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteChunk}
            disabled={isDeleting}
            className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
          >
            {isDeleting ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className='mr-2 h-4 w-4' />
                Delete
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
