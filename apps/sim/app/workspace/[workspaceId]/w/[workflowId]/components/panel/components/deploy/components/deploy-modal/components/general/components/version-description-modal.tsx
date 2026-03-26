'use client'

import { useCallback, useRef, useState } from 'react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import {
  useGenerateVersionDescription,
  useUpdateDeploymentVersion,
} from '@/hooks/queries/deployments'

interface VersionDescriptionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
  version: number
  versionName: string
  currentDescription: string | null | undefined
}

export function VersionDescriptionModal({
  open,
  onOpenChange,
  workflowId,
  version,
  versionName,
  currentDescription,
}: VersionDescriptionModalProps) {
  const initialDescriptionRef = useRef(currentDescription || '')
  const [description, setDescription] = useState(initialDescriptionRef.current)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)

  const updateMutation = useUpdateDeploymentVersion()
  const generateMutation = useGenerateVersionDescription()

  const hasChanges = description.trim() !== initialDescriptionRef.current.trim()
  const isGenerating = generateMutation.isPending

  const handleCloseAttempt = useCallback(() => {
    if (updateMutation.isPending || isGenerating) {
      return
    }
    if (hasChanges) {
      setShowUnsavedChangesAlert(true)
    } else {
      onOpenChange(false)
    }
  }, [hasChanges, updateMutation.isPending, isGenerating, onOpenChange])

  const handleDiscardChanges = useCallback(() => {
    setShowUnsavedChangesAlert(false)
    setDescription(initialDescriptionRef.current)
    onOpenChange(false)
  }, [onOpenChange])

  const handleGenerateDescription = useCallback(() => {
    generateMutation.mutate({
      workflowId,
      version,
      onStreamChunk: (accumulated) => {
        setDescription(accumulated)
      },
    })
  }, [workflowId, version, generateMutation])

  const handleSave = useCallback(() => {
    if (!workflowId) return

    updateMutation.mutate(
      {
        workflowId,
        version,
        description: description.trim() || null,
      },
      {
        onSuccess: () => {
          onOpenChange(false)
        },
      }
    )
  }, [workflowId, version, description, updateMutation, onOpenChange])

  return (
    <>
      <Modal open={open} onOpenChange={(openState) => !openState && handleCloseAttempt()}>
        <ModalContent size='md'>
          <ModalHeader>
            <span>Version Description</span>
          </ModalHeader>
          <ModalBody className='space-y-2.5'>
            <div className='flex items-center justify-between'>
              <p className='text-[var(--text-secondary)]'>
                {currentDescription ? 'Edit the' : 'Add a'} description for{' '}
                <span className='font-medium text-[var(--text-primary)]'>{versionName}</span>
              </p>
              <Button
                variant='active'
                className='-my-1 h-5 px-2 py-0 text-xs'
                onClick={handleGenerateDescription}
                disabled={isGenerating || updateMutation.isPending}
              >
                {isGenerating ? 'Generating...' : 'Generate'}
              </Button>
            </div>
            <Textarea
              placeholder='Describe the changes in this deployment version...'
              className='min-h-[120px] resize-none'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              disabled={isGenerating}
            />
            <div className='flex items-center justify-between'>
              {(updateMutation.error || generateMutation.error) && (
                <p className='text-[var(--text-error)] text-caption'>
                  {updateMutation.error?.message || generateMutation.error?.message}
                </p>
              )}
              {!updateMutation.error && !generateMutation.error && <div />}
              <p className='text-[var(--text-tertiary)] text-xs'>{description.length}/2000</p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={handleCloseAttempt}
              disabled={updateMutation.isPending || isGenerating}
            >
              Cancel
            </Button>
            <Button
              variant='tertiary'
              onClick={handleSave}
              disabled={updateMutation.isPending || isGenerating || !hasChanges}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
        <ModalContent size='sm'>
          <ModalHeader>
            <span>Unsaved Changes</span>
          </ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)] text-sm'>
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
