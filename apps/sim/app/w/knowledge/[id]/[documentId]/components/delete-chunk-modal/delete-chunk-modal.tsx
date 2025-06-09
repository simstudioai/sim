'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
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
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30'>
              <AlertTriangle className='h-5 w-5 text-red-600 dark:text-red-400' />
            </div>
            <div>
              <AlertDialogTitle className='text-left'>Delete Chunk</AlertDialogTitle>
              <AlertDialogDescription className='text-left'>
                Are you sure you want to delete chunk #{chunk.chunkIndex}?
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        {/* Show chunk preview */}
        <div className='my-4 rounded-md border bg-muted/30 p-3'>
          <div className='mb-2 flex items-center gap-2 text-muted-foreground text-sm'>
            <Trash2 className='h-4 w-4' />
            <span>Chunk #{chunk.chunkIndex}</span>
          </div>
          <div className='text-sm'>
            {chunk.content.length > 150 ? `${chunk.content.substring(0, 150)}...` : chunk.content}
          </div>
          <div className='mt-2 text-muted-foreground text-xs'>
            {chunk.tokenCount} tokens • {chunk.content.length} characters
          </div>
        </div>

        <AlertDialogDescription>
          This action cannot be undone. The chunk will be permanently removed from your knowledge
          base.
        </AlertDialogDescription>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteChunk}
            disabled={isDeleting}
            className='bg-red-600 text-white hover:bg-red-700 focus:ring-red-600'
          >
            {isDeleting ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className='mr-2 h-4 w-4' />
                Delete Chunk
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
