'use client'

import { useRef, useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Button, Textarea } from '@/components/emcn'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn/components/modal/modal'
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
        <ModalContent className='h-[74vh] sm:max-w-[600px]'>
          <ModalHeader>Create Chunk</ModalHeader>

          <form className='flex min-h-0 flex-1 flex-col'>
            <ModalBody>
              <div className='space-y-[12px]'>
                {/* Document Info Section */}
                <div className='flex items-center gap-3 rounded-lg border p-4'>
                  <div className='min-w-0 flex-1'>
                    <p className='font-medium text-[var(--text-primary)] text-sm'>
                      {document?.filename || 'Unknown Document'}
                    </p>
                    <p className='text-[var(--text-tertiary)] text-xs'>
                      Adding chunk to this document
                    </p>
                  </div>
                </div>

                {/* Error Display */}
                {error && (
                  <div className='flex items-center gap-2 rounded-md border border-[var(--text-error)]/50 bg-[var(--text-error)]/10 p-3'>
                    <AlertCircle className='h-4 w-4 text-[var(--text-error)]' />
                    <p className='text-[var(--text-error)] text-sm'>{error}</p>
                  </div>
                )}

                {/* Content Input Section */}
                <div className='space-y-[8px]'>
                  <Label
                    htmlFor='content'
                    className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'
                  >
                    Chunk Content
                  </Label>
                  <Textarea
                    id='content'
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder='Enter the content for this chunk...'
                    rows={10}
                    disabled={isCreating}
                  />
                </div>
              </div>
            </ModalBody>

            <ModalFooter>
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
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Unsaved Changes Alert */}
      <Modal open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Discard Changes</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-tertiary)]'>
              You have unsaved changes. Are you sure you want to close without saving?
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => setShowUnsavedChangesAlert(false)}
              type='button'
            >
              Keep Editing
            </Button>
            <Button
              variant='primary'
              onClick={handleConfirmDiscard}
              type='button'
              className='!bg-[var(--text-error)] !text-white hover:!bg-[var(--text-error)]/90'
            >
              Discard Changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
