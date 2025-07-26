'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/components/providers/workspace-permissions-provider'
import type { ChunkData, DocumentData } from '@/stores/knowledge/store'

const logger = createLogger('EditChunkModal')

interface EditChunkModalProps {
  chunk: ChunkData | null
  document: DocumentData | null
  knowledgeBaseId: string
  isOpen: boolean
  onClose: () => void
  onChunkUpdate?: (updatedChunk: ChunkData) => void
  // New props for navigation
  allChunks?: ChunkData[]
  currentPage?: number
  totalPages?: number
  onNavigateToChunk?: (chunk: ChunkData) => void
  onNavigateToPage?: (page: number, selectChunk: 'first' | 'last') => Promise<void>
}

export function EditChunkModal({
  chunk,
  document,
  knowledgeBaseId,
  isOpen,
  onClose,
  onChunkUpdate,
  allChunks = [],
  currentPage = 1,
  totalPages = 1,
  onNavigateToChunk,
  onNavigateToPage,
}: EditChunkModalProps) {
  const userPermissions = useUserPermissionsContext()
  const [editedContent, setEditedContent] = useState(chunk?.content || '')
  const [isSaving, setIsSaving] = useState(false)
  const [isNavigating, setIsNavigating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null)

  // Check if there are unsaved changes
  const hasUnsavedChanges = editedContent !== (chunk?.content || '')

  // Update edited content when chunk changes
  useEffect(() => {
    if (chunk?.content) {
      setEditedContent(chunk.content)
    }
  }, [chunk?.id, chunk?.content])

  // Find current chunk index in the current page
  const currentChunkIndex = chunk ? allChunks.findIndex((c) => c.id === chunk.id) : -1

  // Calculate navigation availability
  const canNavigatePrev = currentChunkIndex > 0 || currentPage > 1
  const canNavigateNext = currentChunkIndex < allChunks.length - 1 || currentPage < totalPages

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
      }
    } catch (err) {
      logger.error('Error updating chunk:', err)
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSaving(false)
    }
  }

  const navigateToChunk = async (direction: 'prev' | 'next') => {
    if (!chunk || isNavigating) return

    try {
      setIsNavigating(true)

      if (direction === 'prev') {
        if (currentChunkIndex > 0) {
          // Navigate to previous chunk in current page
          const prevChunk = allChunks[currentChunkIndex - 1]
          onNavigateToChunk?.(prevChunk)
        } else if (currentPage > 1) {
          // Load previous page and navigate to last chunk
          await onNavigateToPage?.(currentPage - 1, 'last')
        }
      } else {
        if (currentChunkIndex < allChunks.length - 1) {
          // Navigate to next chunk in current page
          const nextChunk = allChunks[currentChunkIndex + 1]
          onNavigateToChunk?.(nextChunk)
        } else if (currentPage < totalPages) {
          // Load next page and navigate to first chunk
          await onNavigateToPage?.(currentPage + 1, 'first')
        }
      }
    } catch (err) {
      logger.error(`Error navigating ${direction}:`, err)
      setError(`Failed to navigate to ${direction === 'prev' ? 'previous' : 'next'} chunk`)
    } finally {
      setIsNavigating(false)
    }
  }

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (hasUnsavedChanges) {
      setPendingNavigation(() => () => navigateToChunk(direction))
      setShowUnsavedChangesAlert(true)
    } else {
      void navigateToChunk(direction)
    }
  }

  const handleCloseAttempt = () => {
    if (hasUnsavedChanges && !isSaving) {
      setPendingNavigation(null)
      setShowUnsavedChangesAlert(true)
    } else {
      onClose()
    }
  }

  const handleConfirmDiscard = () => {
    setShowUnsavedChangesAlert(false)
    if (pendingNavigation) {
      void pendingNavigation()
      setPendingNavigation(null)
    } else {
      onClose()
    }
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
              <div className='flex items-center gap-3'>
                <DialogTitle className='font-medium text-lg'>Edit Chunk</DialogTitle>

                {/* Navigation Controls */}
                <div className='flex items-center gap-1'>
                  <Tooltip>
                    <TooltipTrigger
                      asChild
                      onFocus={(e) => e.preventDefault()}
                      onBlur={(e) => e.preventDefault()}
                    >
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => handleNavigate('prev')}
                        disabled={!canNavigatePrev || isNavigating || isSaving}
                        className='h-8 w-8 p-0'
                      >
                        <ChevronUp className='h-4 w-4' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side='bottom'>
                      Previous chunk{' '}
                      {currentPage > 1 && currentChunkIndex === 0 ? '(previous page)' : ''}
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger
                      asChild
                      onFocus={(e) => e.preventDefault()}
                      onBlur={(e) => e.preventDefault()}
                    >
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => handleNavigate('next')}
                        disabled={!canNavigateNext || isNavigating || isSaving}
                        className='h-8 w-8 p-0'
                      >
                        <ChevronDown className='h-4 w-4' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side='bottom'>
                      Next chunk{' '}
                      {currentPage < totalPages && currentChunkIndex === allChunks.length - 1
                        ? '(next page)'
                        : ''}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>

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
                        Editing chunk #{chunk.chunkIndex} • Page {currentPage} of {totalPages}
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
                    placeholder={
                      userPermissions.canEdit ? 'Enter chunk content...' : 'Read-only view'
                    }
                    className='flex-1 resize-none'
                    disabled={isSaving || isNavigating || !userPermissions.canEdit}
                    readOnly={!userPermissions.canEdit}
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className='mt-auto border-t px-6 pt-4 pb-6'>
              <div className='flex justify-between'>
                <Button
                  variant='outline'
                  onClick={handleCloseAttempt}
                  disabled={isSaving || isNavigating}
                >
                  Cancel
                </Button>
                {userPermissions.canEdit && (
                  <Button
                    onClick={handleSaveContent}
                    disabled={!isFormValid || isSaving || !hasUnsavedChanges || isNavigating}
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
                )}
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
              You have unsaved changes to this chunk content.
              {pendingNavigation
                ? ' Do you want to discard your changes and navigate to the next chunk?'
                : ' Are you sure you want to discard your changes and close the editor?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setShowUnsavedChangesAlert(false)
                setPendingNavigation(null)
              }}
            >
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
