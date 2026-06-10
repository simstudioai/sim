'use client'

import { useRef, useState } from 'react'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipTextarea,
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

  const handleCloseAttempt = () => {
    if (updateMutation.isPending || isGenerating) {
      return
    }
    if (hasChanges) {
      setShowUnsavedChangesAlert(true)
    } else {
      onOpenChange(false)
    }
  }

  const handleDiscardChanges = () => {
    setShowUnsavedChangesAlert(false)
    setDescription(initialDescriptionRef.current)
    onOpenChange(false)
  }

  const handleGenerateDescription = () => {
    generateMutation.mutate({
      workflowId,
      version,
      onStreamChunk: (accumulated) => {
        setDescription(accumulated)
      },
    })
  }

  const handleSave = () => {
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
  }

  return (
    <>
      <ChipModal
        open={open}
        onOpenChange={(openState) => !openState && handleCloseAttempt()}
        srTitle='Version Description'
      >
        <ChipModalHeader onClose={() => handleCloseAttempt()}>Version Description</ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='custom'
            title={
              <span>
                {currentDescription ? 'Edit the' : 'Add a'} description for{' '}
                <span className='font-medium text-[var(--text-primary)]'>{versionName}</span>
              </span>
            }
            hint={`${description.length}/2000`}
          >
            <div className='flex justify-end'>
              <Chip
                flush
                onClick={handleGenerateDescription}
                disabled={isGenerating || updateMutation.isPending}
              >
                {isGenerating ? 'Generating...' : 'Generate'}
              </Chip>
            </div>
            <ChipTextarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder='Describe the changes in this deployment version...'
              maxLength={2000}
              disabled={isGenerating}
              className='min-h-[120px]'
              aria-label='Version description'
            />
          </ChipModalField>
          <ChipModalError>
            {updateMutation.error?.message || generateMutation.error?.message}
          </ChipModalError>
        </ChipModalBody>
        <ChipModalFooter>
          <Chip
            flush
            onClick={handleCloseAttempt}
            disabled={updateMutation.isPending || isGenerating}
          >
            Cancel
          </Chip>
          <Chip
            variant='primary'
            flush
            onClick={handleSave}
            disabled={updateMutation.isPending || isGenerating || !hasChanges}
          >
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </Chip>
        </ChipModalFooter>
      </ChipModal>

      <ChipModal
        open={showUnsavedChangesAlert}
        onOpenChange={setShowUnsavedChangesAlert}
        srTitle='Unsaved Changes'
      >
        <ChipModalHeader showDivider={false}>Unsaved Changes</ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            You have unsaved changes. Are you sure you want to discard them?
          </p>
        </ChipModalBody>
        <ChipModalFooter>
          <Chip flush onClick={() => setShowUnsavedChangesAlert(false)}>
            Keep Editing
          </Chip>
          <Chip variant='destructive' flush onClick={handleDiscardChanges}>
            Discard Changes
          </Chip>
        </ChipModalFooter>
      </ChipModal>
    </>
  )
}
