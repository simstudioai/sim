'use client'

import { useCallback, useState } from 'react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import { useUpdateDeploymentVersion } from '@/hooks/queries/deployments'

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
  // Initialize state from props - component remounts via key prop when version changes
  const initialDescription = currentDescription || ''
  const [description, setDescription] = useState(initialDescription)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)

  const updateMutation = useUpdateDeploymentVersion()

  const hasChanges = description.trim() !== initialDescription.trim()

  const handleCloseAttempt = useCallback(() => {
    if (hasChanges && !updateMutation.isPending) {
      setShowUnsavedChangesAlert(true)
    } else {
      onOpenChange(false)
    }
  }, [hasChanges, updateMutation.isPending, onOpenChange])

  const handleDiscardChanges = useCallback(() => {
    setShowUnsavedChangesAlert(false)
    setDescription(initialDescription)
    onOpenChange(false)
  }, [initialDescription, onOpenChange])

  const handleSave = useCallback(async () => {
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
        <ModalContent className='max-w-[480px]'>
          <ModalHeader>
            <span>Version Description</span>
          </ModalHeader>
          <ModalBody className='space-y-[12px]'>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              {currentDescription ? 'Edit the' : 'Add a'} description for{' '}
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
              {updateMutation.error ? (
                <p className='text-[12px] text-[var(--text-error)]'>
                  {updateMutation.error.message}
                </p>
              ) : (
                <div />
              )}
              <p className='text-[11px] text-[var(--text-tertiary)]'>{description.length}/500</p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={handleCloseAttempt}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant='tertiary'
              onClick={handleSave}
              disabled={updateMutation.isPending || !hasChanges}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
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
