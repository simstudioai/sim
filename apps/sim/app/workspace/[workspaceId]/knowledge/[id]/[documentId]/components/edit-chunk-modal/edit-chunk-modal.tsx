'use client'

import { useEffect, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { createLogger } from '@sim/logger'
import { AlertCircle, ChevronDown, ChevronUp, X } from 'lucide-react'
import {
  Button,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
  Tooltip,
} from '@/components/emcn'
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
        <ModalContent size='lg'>
          <div className='flex items-center justify-between px-[16px] py-[10px]'>
            <DialogPrimitive.Title className='font-medium text-[16px] text-[var(--text-primary)]'>
              Edit Chunk #{chunk.chunkIndex}
            </DialogPrimitive.Title>

            <div className='flex flex-shrink-0 items-center gap-[8px]'>
              {/* Navigation Controls */}
              <div className='flex items-center gap-[6px]'>
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
                      className='h-[16px] w-[16px] p-0'
                    >
                      <ChevronUp className='h-[16px] w-[16px]' />
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
                      className='h-[16px] w-[16px] p-0'
                    >
                      <ChevronDown className='h-[16px] w-[16px]' />
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

              <Button
                variant='ghost'
                className='h-[16px] w-[16px] p-0'
                onClick={handleCloseAttempt}
              >
                <X className='h-[16px] w-[16px]' />
                <span className='sr-only'>Close</span>
              </Button>
            </div>
          </div>

          <form>
            <ModalBody className='!pb-[16px]'>
              <div className='flex flex-col gap-[8px]'>
                {/* Error Display */}
                {error && (
                  <div className='flex items-center gap-2 rounded-md border border-[var(--text-error)]/50 bg-[var(--text-error)]/10 p-3'>
                    <AlertCircle className='h-4 w-4 text-[var(--text-error)]' />
                    <p className='text-[var(--text-error)] text-sm'>{error}</p>
                  </div>
                )}

                {/* Content Input Section */}
                <Label htmlFor='content'>Chunk</Label>
                <Textarea
                  id='content'
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  placeholder={
                    userPermissions.canEdit ? 'Enter chunk content...' : 'Read-only view'
                  }
                  rows={20}
                  disabled={isSaving || isNavigating || !userPermissions.canEdit}
                  readOnly={!userPermissions.canEdit}
                />
              </div>
            </ModalBody>

            <ModalFooter>
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
                  variant='tertiary'
                  onClick={handleSaveContent}
                  type='button'
                  disabled={!isFormValid || isSaving || !hasUnsavedChanges || isNavigating}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              )}
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Unsaved Changes Alert */}
      <Modal open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
        <ModalContent size='sm'>
          <ModalHeader>Unsaved Changes</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              You have unsaved changes to this chunk content.
              {pendingNavigation
                ? ' Do you want to discard your changes and navigate to the next chunk?'
                : ' Are you sure you want to discard your changes and close the editor?'}
            </p>
          </ModalBody>
          <ModalFooter>
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
            <Button variant='destructive' onClick={handleConfirmDiscard} type='button'>
              Discard Changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
