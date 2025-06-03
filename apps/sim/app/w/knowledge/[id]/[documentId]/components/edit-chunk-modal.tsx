'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
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
import type { DocumentData } from '@/stores/knowledge/knowledge'

const logger = createLogger('EditChunkModal')

interface ChunkData {
  id: string
  chunkIndex: number
  content: string
  contentLength: number
  tokenCount: number
  enabled: boolean
  startOffset: number
  endOffset: number
  overlapTokens: number
  metadata: any
  searchRank: string
  qualityScore: string | null
  createdAt: string
  updatedAt: string
}

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
        throw new Error('Failed to update chunk')
      }

      const result = await response.json()

      if (result.success && onChunkUpdate) {
        onChunkUpdate(result.data)
        handleCloseModal()
      }
    } catch (error) {
      logger.error('Error updating chunk:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCloseModal = () => {
    onClose()
    setEditedContent('')
  }

  const handleCloseAttempt = () => {
    if (hasUnsavedChanges && !isSaving) {
      setShowUnsavedChangesAlert(true)
    } else {
      handleCloseModal()
    }
  }

  const handleCancel = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedChangesAlert(true)
    } else {
      handleCloseModal()
    }
  }

  const handleConfirmDiscard = () => {
    setShowUnsavedChangesAlert(false)
    handleCloseModal()
  }

  const handleKeepEditing = () => {
    setShowUnsavedChangesAlert(false)
  }

  if (!chunk || !document) return null

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleCloseAttempt}>
        <DialogContent
          className='flex h-[80vh] max-h-[900px] w-[95vw] max-w-4xl flex-col gap-0 overflow-hidden p-0'
          hideCloseButton
        >
          <DialogHeader className='flex-shrink-0 border-b bg-background/95 px-8 py-6 backdrop-blur supports-[backdrop-filter]:bg-background/80'>
            <div className='flex items-center justify-between'>
              <div className='space-y-1'>
                <DialogTitle className='font-semibold text-xl tracking-tight'>
                  Edit Chunk Content
                </DialogTitle>
                <p className='text-muted-foreground text-sm'>
                  Modify the content of this knowledge chunk
                </p>
              </div>
              <Button
                variant='ghost'
                size='icon'
                className='h-9 w-9 rounded-full transition-colors hover:bg-muted/50'
                onClick={handleCloseAttempt}
              >
                <X className='h-4 w-4' />
                <span className='sr-only'>Close</span>
              </Button>
            </div>
          </DialogHeader>

          <div className='flex flex-1 flex-col overflow-hidden'>
            <form className='flex h-full flex-col'>
              {/* Scrollable Content */}
              <div className='scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/30 scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-8'>
                <div className='py-6'>
                  <div className='space-y-3'>
                    <div className='flex items-center justify-between'>
                      <Label htmlFor='content' className='font-medium text-sm'>
                        Content
                      </Label>
                      <div className='flex items-center gap-4 text-muted-foreground text-xs'>
                        <span>Characters: {editedContent.length}</span>
                        <span>•</span>
                        <span>Tokens: ~{Math.ceil(editedContent.length / 4)}</span>
                      </div>
                    </div>
                    <Textarea
                      id='content'
                      value={editedContent}
                      onChange={(e) => setEditedContent(e.target.value)}
                      placeholder='Enter chunk content...'
                      className='min-h-[500px] resize-none border-input/50 text-sm leading-relaxed focus:border-primary/50 focus:ring-2 focus:ring-primary/10'
                    />
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className='flex-shrink-0 border-t bg-background/95 px-8 py-6 backdrop-blur supports-[backdrop-filter]:bg-background/80'>
                <div className='flex items-center justify-between'>
                  <div className='text-muted-foreground text-xs'>
                    {hasUnsavedChanges && (
                      <span className='flex items-center gap-1 text-amber-600'>
                        <div className='h-1.5 w-1.5 rounded-full bg-amber-500' />
                        Unsaved changes
                      </span>
                    )}
                  </div>
                  <div className='flex items-center gap-3'>
                    <Button
                      variant='outline'
                      onClick={handleCancel}
                      type='button'
                      disabled={isSaving}
                      className='px-6'
                    >
                      Cancel
                    </Button>
                    <Button
                      type='button'
                      onClick={handleSaveContent}
                      disabled={isSaving || !hasUnsavedChanges}
                      className='bg-[#701FFC] px-8 font-medium text-white shadow-lg transition-all duration-200 hover:bg-[#6518E6] hover:shadow-[#701FFC]/25 hover:shadow-xl disabled:opacity-50 disabled:shadow-none'
                    >
                      {isSaving ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>

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
            <AlertDialogCancel onClick={handleKeepEditing}>Keep Editing</AlertDialogCancel>
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
