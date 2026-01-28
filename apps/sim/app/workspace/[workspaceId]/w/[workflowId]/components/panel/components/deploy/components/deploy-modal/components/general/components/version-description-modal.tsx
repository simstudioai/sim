'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'

const logger = createLogger('VersionDescriptionModal')

interface VersionDescriptionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
  version: number
  versionName: string
  currentDescription: string | null | undefined
  onSave: () => Promise<void>
}

export function VersionDescriptionModal({
  open,
  onOpenChange,
  workflowId,
  version,
  versionName,
  currentDescription,
  onSave,
}: VersionDescriptionModalProps) {
  const [description, setDescription] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)

  const initialDescriptionRef = useRef('')

  useEffect(() => {
    if (open) {
      const initialDescription = currentDescription || ''
      setDescription(initialDescription)
      initialDescriptionRef.current = initialDescription
      setError(null)
    }
  }, [open, currentDescription])

  const hasChanges = description.trim() !== initialDescriptionRef.current.trim()

  const handleCloseAttempt = useCallback(() => {
    if (hasChanges && !isSaving) {
      setShowUnsavedChangesAlert(true)
    } else {
      onOpenChange(false)
    }
  }, [hasChanges, isSaving, onOpenChange])

  const handleDiscardChanges = useCallback(() => {
    setShowUnsavedChangesAlert(false)
    setDescription(initialDescriptionRef.current)
    onOpenChange(false)
  }, [onOpenChange])

  const handleSave = useCallback(async () => {
    if (!workflowId) return

    setIsSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/workflows/${workflowId}/deployments/${version}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim() || null }),
      })

      if (res.ok) {
        await onSave()
        onOpenChange(false)
      } else {
        const data = await res.json().catch(() => ({}))
        const message = data.error || 'Failed to save description'
        setError(message)
        logger.error('Failed to save description:', message)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred'
      setError(message)
      logger.error('Error saving description:', err)
    } finally {
      setIsSaving(false)
    }
  }, [workflowId, version, description, onSave, onOpenChange])

  return (
    <>
      <Modal open={open} onOpenChange={(openState) => !openState && handleCloseAttempt()}>
        <ModalContent className='max-w-[480px]'>
          <ModalHeader>
            <span>Version Description</span>
          </ModalHeader>
          <ModalBody className='space-y-[12px]'>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              {currentDescription ? 'Edit' : 'Add'} a description for{' '}
              <span className='font-medium text-[var(--text-primary)]'>{versionName}</span>
            </p>
            <Textarea
              placeholder='Describe the changes in this deployment version...'
              className='min-h-[120px] resize-none'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
            <div className='flex items-center justify-between'>
              {error ? <p className='text-[12px] text-[var(--text-error)]'>{error}</p> : <div />}
              <p className='text-[11px] text-[var(--text-tertiary)]'>{description.length}/500</p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={handleCloseAttempt} disabled={isSaving}>
              Cancel
            </Button>
            <Button variant='tertiary' onClick={handleSave} disabled={isSaving || !hasChanges}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
        <ModalContent className='max-w-[400px]'>
          <ModalHeader>
            <span>Unsaved Changes</span>
          </ModalHeader>
          <ModalBody>
            <p className='text-[14px] text-[var(--text-secondary)]'>
              You have unsaved changes. Are you sure you want to discard them?
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowUnsavedChangesAlert(false)}>
              Keep Editing
            </Button>
            <Button variant='destructive' onClick={handleDiscardChanges}>
              Discard Changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
