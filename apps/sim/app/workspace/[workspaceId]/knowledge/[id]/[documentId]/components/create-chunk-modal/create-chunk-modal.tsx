'use client'

import { useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Button,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import type { DocumentData } from '@/lib/knowledge/types'
import { useCreateChunk } from '@/hooks/queries/knowledge'

const logger = createLogger('CreateChunkModal')

interface CreateChunkModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: DocumentData | null
  knowledgeBaseId: string
}

export function CreateChunkModal({
  open,
  onOpenChange,
  document,
  knowledgeBaseId,
}: CreateChunkModalProps) {
  const {
    mutate: createChunk,
    isPending: isCreating,
    error: mutationError,
    reset: resetMutation,
  } = useCreateChunk()
  const [content, setContent] = useState('')
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)
  const isProcessingRef = useRef(false)

  const error = mutationError?.message ?? null
  const hasUnsavedChanges = content.trim().length > 0

  const handleCreateChunk = () => {
    if (!document || content.trim().length === 0 || isProcessingRef.current) {
      if (isProcessingRef.current) {
        logger.warn('Chunk creation already in progress, ignoring duplicate request')
      }
      return
    }

    isProcessingRef.current = true

    createChunk(
      {
        knowledgeBaseId,
        documentId: document.id,
        content: content.trim(),
        enabled: true,
      },
      {
        onSuccess: () => {
          isProcessingRef.current = false
          onClose()
        },
        onError: () => {
          isProcessingRef.current = false
        },
      }
    )
  }

  const onClose = () => {
    onOpenChange(false)
    setContent('')
    setShowUnsavedChangesAlert(false)
    resetMutation()
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
        <ModalContent size='lg'>
          <ModalHeader>Create Chunk</ModalHeader>

          <form>
            <ModalBody>
              <div className='flex flex-col gap-[8px]'>
                {error && <p className='text-[12px] text-[var(--text-error)]'>{error}</p>}

                {/* Content Input Section */}
                <Label htmlFor='content'>Chunk</Label>
                <Textarea
                  id='content'
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder='Enter the content for this chunk...'
                  rows={12}
                  disabled={isCreating}
                />
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
                variant='tertiary'
                onClick={handleCreateChunk}
                type='button'
                disabled={!isFormValid || isCreating}
              >
                {isCreating ? 'Creating...' : 'Create Chunk'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Unsaved Changes Alert */}
      <Modal open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
        <ModalContent size='sm'>
          <ModalHeader>Discard Changes</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
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
            <Button variant='destructive' onClick={handleConfirmDiscard} type='button'>
              Discard Changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
