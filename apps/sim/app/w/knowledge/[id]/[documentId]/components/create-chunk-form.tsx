'use client'

import { useRef, useState } from 'react'
import { AlertCircle, FileText, Loader2 } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createLogger } from '@/lib/logs/console-logger'
import type { ChunkData, DocumentData } from '@/stores/knowledge/store'

const logger = createLogger('CreateChunkForm')

interface CreateChunkFormProps {
  document: DocumentData | null
  knowledgeBaseId: string
  onClose: () => void
  onChunkCreated?: (chunk: ChunkData) => void
}

export function CreateChunkForm({
  document,
  knowledgeBaseId,
  onClose,
  onChunkCreated,
}: CreateChunkFormProps) {
  const [content, setContent] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)
  const isProcessingRef = useRef(false)

  const hasUnsavedChanges = content.trim().length > 0

  const handleCreateChunk = async () => {
    if (!document || content.trim().length === 0 || isProcessingRef.current) {
      if (isProcessingRef.current) {
        logger.warn('Chunk creation already in progress, ignoring duplicate request')
      }
      return
    }

    try {
      isProcessingRef.current = true
      setIsCreating(true)
      setError(null)

      const response = await fetch(
        `/api/knowledge/${knowledgeBaseId}/documents/${document.id}/chunks`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: content.trim(),
            enabled,
          }),
        }
      )

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to create chunk')
      }

      const result = await response.json()

      if (result.success && result.data) {
        logger.info('Chunk created successfully:', result.data.id)

        if (onChunkCreated) {
          onChunkCreated(result.data)
        }

        onClose()
      } else {
        throw new Error(result.error || 'Failed to create chunk')
      }
    } catch (err) {
      logger.error('Error creating chunk:', err)
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      isProcessingRef.current = false
      setIsCreating(false)
    }
  }

  const handleCloseAttempt = () => {
    if (hasUnsavedChanges && !isCreating) {
      setShowUnsavedChangesAlert(true)
    } else {
      onClose()
    }
  }

  const handleConfirmDiscard = () => {
    setShowUnsavedChangesAlert(false)
    onClose()
  }

  const isFormValid = content.trim().length > 0 && content.trim().length <= 10000

  return (
    <>
      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='flex-1 overflow-auto p-6'>
          <div className='space-y-6'>
            {/* Document Info */}
            <div className='flex items-center gap-3 rounded-lg border bg-muted/30 p-4'>
              <FileText className='h-5 w-5 text-muted-foreground' />
              <div className='min-w-0 flex-1'>
                <p className='font-medium text-sm'>{document?.filename || 'Unknown Document'}</p>
                <p className='text-muted-foreground text-xs'>Adding chunk to this document</p>
              </div>
            </div>

            {/* Content Input */}
            <div className='space-y-2'>
              <Label htmlFor='content' className='font-medium text-sm'>
                Chunk Content
              </Label>
              <Textarea
                id='content'
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder='Enter the content for this chunk...'
                className='min-h-[200px] resize-none'
                disabled={isCreating}
              />
              <div className='flex items-center justify-between text-muted-foreground text-xs'>
                <span>{content.length}/10000 characters</span>
                {content.length > 10000 && <span className='text-red-500'>Content too long</span>}
              </div>
            </div>

            {/* Enabled Toggle */}
            <div className='flex items-center space-x-2'>
              <Checkbox
                id='enabled'
                checked={enabled}
                onCheckedChange={(checked) => setEnabled(checked as boolean)}
                disabled={isCreating}
                className='h-4 w-4'
              />
              <Label htmlFor='enabled' className='text-sm'>
                Enable chunk for search
              </Label>
            </div>

            {/* Error Display */}
            {error && (
              <div className='flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3'>
                <AlertCircle className='h-4 w-4 text-red-600' />
                <p className='text-red-800 text-sm'>{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className='flex-shrink-0 border-t bg-background px-6 py-4'>
          <div className='flex items-center justify-end gap-3'>
            <Button variant='outline' onClick={handleCloseAttempt} disabled={isCreating}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateChunk}
              disabled={!isFormValid || isCreating}
              className='bg-[#701FFC] hover:bg-[#6518E6]'
            >
              {isCreating ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Creating...
                </>
              ) : (
                'Create Chunk'
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Unsaved Changes Alert */}
      <AlertDialog open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to close without saving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowUnsavedChangesAlert(false)}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDiscard}>Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
