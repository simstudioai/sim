'use client'

import { useRef, useState } from 'react'
import { AlertCircle, Loader2, X } from 'lucide-react'
import { Button, Modal, ModalContent, ModalTitle, Textarea } from '@/components/emcn'
import { Label } from '@/components/ui/label'
import { createLogger } from '@/lib/logs/console/logger'
import type { ChunkData, DocumentData } from '@/stores/knowledge/store'

const logger = createLogger('CreateChunkModal')

interface CreateChunkModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: DocumentData | null
  knowledgeBaseId: string
  onChunkCreated?: (chunk: ChunkData) => void
}

export function CreateChunkModal({
  open,
  onOpenChange,
  document,
  knowledgeBaseId,
  onChunkCreated,
}: CreateChunkModalProps) {
  const [content, setContent] = useState('')
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
            enabled: true,
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

  const onClose = () => {
    onOpenChange(false)
    // Reset form state when modal closes
    setContent('')
    setError(null)
    setShowUnsavedChangesAlert(false)
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
      <Modal open={open} onOpenChange={handleCloseAttempt}>
        <ModalContent
          className='flex h-[74vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]'
          showClose={false}
        >
          {/* Modal Header */}
          <div className='flex-shrink-0 px-6 py-5'>
            <div className='flex items-center justify-between'>
              <ModalTitle className='font-medium text-[14px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                Create Chunk
              </ModalTitle>
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
                            Adding chunk to this document
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
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder='Enter the content for this chunk...'
                        className='min-h-0 flex-1 resize-none'
                        disabled={isCreating}
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
                    disabled={isCreating}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant='primary'
                    onClick={handleCreateChunk}
                    type='button'
                    disabled={!isFormValid || isCreating}
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
              Discard changes?
            </ModalTitle>
            <p className='mt-2 text-[12px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
              You have unsaved changes. Are you sure you want to close without saving?
            </p>
          </div>

          {/* Modal Footer */}
          <div className='flex w-full items-center justify-between gap-[8px] px-6 py-4'>
            <Button
              variant='default'
              onClick={() => setShowUnsavedChangesAlert(false)}
              type='button'
            >
              Keep editing
            </Button>
            <Button variant='primary' onClick={handleConfirmDiscard} type='button'>
              Discard changes
            </Button>
          </div>
        </ModalContent>
      </Modal>
    </>
  )
}
