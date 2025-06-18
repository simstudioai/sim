'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, X } from 'lucide-react'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createLogger } from '@/lib/logs/console-logger'
import type { ChunkData, DocumentData } from '@/stores/knowledge/store'

const logger = createLogger('EditChunkModal')

interface EditChunkModalProps {
  chunk: ChunkData | null
  document: DocumentData | null
  knowledgeBaseId: string
  isOpen: boolean
  onClose: () => void
  onChunkUpdate?: (updatedChunk: ChunkData) => void
}

export function EditChunkModal({
  chunk,
  document,
  knowledgeBaseId,
  isOpen,
  onClose,
  onChunkUpdate,
}: EditChunkModalProps) {
  const [editedContent, setEditedContent] = useState(chunk?.content || '')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)

  // Check if there are unsaved changes
  const hasUnsavedChanges = editedContent !== (chunk?.content || '')

  // Update edited content when chunk changes
  useEffect(() => {
    if (chunk?.content) {
      setEditedContent(chunk.content)
    }
  }, [chunk?.id, chunk?.content])

  const handleSaveContent = async () => {
    if (!chunk || !document) return

    try {
      setIsSaving(true)
      setError(null)

      const response = await fetch(
        `/api/knowledge/${knowledgeBaseId}/documents/${document.id}/chunks/${chunk.id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: editedContent,
          }),
        }
      )

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to update chunk')
      }

      const result = await response.json()

      if (result.success && onChunkUpdate) {
        onChunkUpdate(result.data)
        onClose()
      }
    } catch (err) {
      logger.error('Error updating chunk:', err)
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCloseAttempt = () => {
    if (hasUnsavedChanges && !isSaving) {
      setShowUnsavedChangesAlert(true)
    } else {
      onClose()
    }
  }

  const handleConfirmDiscard = () => {
    setShowUnsavedChangesAlert(false)
    onClose()
  }

  const isFormValid = editedContent.trim().length > 0 && editedContent.trim().length <= 10000

  if (!chunk || !document) return null

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleCloseAttempt}>
        <DialogContent
          className='flex h-[74vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]'
          hideCloseButton
        >
          <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
            <div className='flex items-center justify-between'>
              <DialogTitle className='font-medium text-lg'>Edit Chunk</DialogTitle>
              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8 p-0'
                onClick={handleCloseAttempt}
              >
                <X className='h-4 w-4' />
                <span className='sr-only'>Close</span>
              </Button>
            </div>
          </DialogHeader>

          <div className='flex flex-1 flex-col overflow-hidden'>
            <div className='scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/25 scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6'>
              <div className='flex min-h-full flex-col py-4'>
                {/* Document Info Section - Fixed at top */}
                <div className='flex-shrink-0 space-y-4'>
                  <div className='flex items-center gap-3 rounded-lg border bg-muted/30 p-4'>
                    <div className='min-w-0 flex-1'>
                      <p className='font-medium text-sm'>
                        {document?.filename || 'Unknown Document'}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        Editing chunk #{chunk.chunkIndex}
                      </p>
                    </div>
                  </div>

                  {/* Error Display */}
                  {error && (
                    <div className='flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3'>
                      <AlertCircle className='h-4 w-4 text-red-600' />
                      <p className='text-red-800 text-sm'>{error}</p>
                    </div>
                  )}
                </div>

                {/* Content Input Section - Expands to fill remaining space */}
                <div className='mt-4 flex flex-1 flex-col'>
                  <Label htmlFor='content' className='mb-2 font-medium text-sm'>
                    Chunk Content
                  </Label>
                  <Textarea
                    id='content'
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    placeholder='Enter chunk content...'
                    className='flex-1 resize-none'
                    disabled={isSaving}
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className='mt-auto border-t px-6 pt-4 pb-6'>
              <div className='flex justify-between'>
                <Button variant='outline' onClick={handleCloseAttempt} disabled={isSaving}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveContent}
                  disabled={!isFormValid || isSaving || !hasUnsavedChanges}
                  className='bg-[#701FFC] font-[480] text-primary-foreground shadow-[0_0_0_0_#701FFC] transition-all duration-200 hover:bg-[#6518E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
                >
                  {isSaving ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Alert */}
      <AlertDialog open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this chunk content. Are you sure you want to discard your
              changes and close the editor?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowUnsavedChangesAlert(false)}>
              Keep Editing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDiscard}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
