'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react'
import {
  Button,
  Label,
  Modal,
  ModalContent,
  ModalTitle,
  Textarea,
  Tooltip,
} from '@/components/emcn'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
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

  const hasUnsavedChanges = editedContent !== (chunk?.content || '')

  useEffect(() => {
    if (chunk?.content) {
      setEditedContent(chunk.content)
    }
  }, [chunk?.id, chunk?.content])

  const currentChunkIndex = chunk ? allChunks.findIndex((c) => c.id === chunk.id) : -1

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
          const prevChunk = allChunks[currentChunkIndex - 1]
          onNavigateToChunk?.(prevChunk)
        } else if (currentPage > 1) {
          await onNavigateToPage?.(currentPage - 1, 'last')
        }
      } else {
        if (currentChunkIndex < allChunks.length - 1) {
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
      <Modal open={isOpen} onOpenChange={handleCloseAttempt}>
        <ModalContent
          className='flex h-[74vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]'
          showClose={false}
        >
          {/* Modal Header */}
          <div className='flex-shrink-0 px-6 py-5'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-3'>
                <ModalTitle className='font-medium text-[14px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                  Edit Chunk
                </ModalTitle>

                {/* Navigation Controls */}
                <div className='flex items-center gap-1'>
                  <Tooltip.Root>
                    <Tooltip.Trigger
                      asChild
                      onFocus={(e) => e.preventDefault()}
                      onBlur={(e) => e.preventDefault()}
                    >
                      <Button
                        variant='ghost'
                        onClick={() => handleNavigate('prev')}
                        disabled={!canNavigatePrev || isNavigating || isSaving}
                        className='h-8 w-8 p-0'
                      >
                        <ChevronUp className='h-4 w-4' />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='bottom'>
                      Previous chunk{' '}
                      {currentPage > 1 && currentChunkIndex === 0 ? '(previous page)' : ''}
                    </Tooltip.Content>
                  </Tooltip.Root>

                  <Tooltip.Root>
                    <Tooltip.Trigger
                      asChild
                      onFocus={(e) => e.preventDefault()}
                      onBlur={(e) => e.preventDefault()}
                    >
                      <Button
                        variant='ghost'
                        onClick={() => handleNavigate('next')}
                        disabled={!canNavigateNext || isNavigating || isSaving}
                        className='h-8 w-8 p-0'
                      >
                        <ChevronDown className='h-4 w-4' />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='bottom'>
                      Next chunk{' '}
                      {currentPage < totalPages && currentChunkIndex === allChunks.length - 1
                        ? '(next page)'
                        : ''}
                    </Tooltip.Content>
                  </Tooltip.Root>
                </div>
              </div>

              <Button variant='ghost' className='h-8 w-8 p-0' onClick={handleCloseAttempt}>
                <X className='h-4 w-4' />
                <span className='sr-only'>Close</span>
              </Button>
            </div>
          </div>

          {/* Modal Body */}
          <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
            <form className='flex min-h-0 flex-1 flex-col'>
              {/* Scrollable Content */}
              <div className='scrollbar-hide min-h-0 flex-1 overflow-y-auto pb-20'>
                <div className='flex min-h-full flex-col px-6'>
                  <div className='flex flex-1 flex-col space-y-[12px] pt-0 pb-6'>
                    {/* Document Info Section */}
                    <div className='flex-shrink-0 space-y-[8px]'>
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

                    {/* Content Input Section - Expands to fill space */}
                    <div className='flex min-h-0 flex-1 flex-col space-y-[8px]'>
                      <Label
                        htmlFor='content'
                        className='font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'
                      >
                        Chunk Content
                      </Label>
                      <Textarea
                        id='content'
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        placeholder={
                          userPermissions.canEdit ? 'Enter chunk content...' : 'Read-only view'
                        }
                        className='min-h-0 flex-1 resize-none'
                        disabled={isSaving || isNavigating || !userPermissions.canEdit}
                        readOnly={!userPermissions.canEdit}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Fixed Footer with Actions */}
              <div className='absolute inset-x-0 bottom-0 bg-[var(--surface-1)] dark:bg-[var(--surface-1)]'>
                <div className='flex w-full items-center justify-between gap-[8px] px-6 py-4'>
                  <Button
                    variant='default'
                    onClick={handleCloseAttempt}
                    type='button'
                    disabled={isSaving || isNavigating}
                  >
                    Cancel
                  </Button>
                  {userPermissions.canEdit && (
                    <Button
                      variant='primary'
                      onClick={handleSaveContent}
                      type='button'
                      disabled={!isFormValid || isSaving || !hasUnsavedChanges || isNavigating}
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
            </form>
          </div>
        </ModalContent>
      </Modal>

      {/* Unsaved Changes Alert */}
      <Modal open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
        <ModalContent className='flex flex-col gap-0 p-0'>
          {/* Modal Header */}
          <div className='flex-shrink-0 px-6 py-5'>
            <ModalTitle className='font-medium text-[14px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
              Unsaved Changes
            </ModalTitle>
            <p className='mt-2 text-[12px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
              You have unsaved changes to this chunk content.
              {pendingNavigation
                ? ' Do you want to discard your changes and navigate to the next chunk?'
                : ' Are you sure you want to discard your changes and close the editor?'}
            </p>
          </div>

          {/* Modal Footer */}
          <div className='flex w-full items-center justify-between gap-[8px] px-6 py-4'>
            <Button
              variant='default'
              onClick={() => {
                setShowUnsavedChangesAlert(false)
                setPendingNavigation(null)
              }}
              type='button'
            >
              Keep Editing
            </Button>
            <Button
              variant='primary'
              onClick={handleConfirmDiscard}
              type='button'
              className='bg-[var(--text-error)] hover:bg-[var(--text-error)] dark:bg-[var(--text-error)] dark:hover:bg-[var(--text-error)]'
            >
              Discard Changes
            </Button>
          </div>
        </ModalContent>
      </Modal>
    </>
  )
}
