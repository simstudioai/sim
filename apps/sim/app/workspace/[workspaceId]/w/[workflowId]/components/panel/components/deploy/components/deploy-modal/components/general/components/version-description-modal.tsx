'use client'

import { useRef, useState } from 'react'
import {
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
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
            type='textarea'
            title={
              <span>
                {currentDescription ? 'Edit the' : 'Add a'} description for{' '}
                <span className='font-medium text-[var(--text-primary)]'>{versionName}</span>
              </span>
            }
            value={description}
            onChange={setDescription}
            placeholder='Describe the changes in this deployment version...'
            maxLength={2000}
            minHeight={120}
            disabled={isGenerating}
            hint={`${description.length}/2000`}
          />
          <ChipModalError>
            {updateMutation.error?.message || generateMutation.error?.message}
          </ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={handleCloseAttempt}
          cancelDisabled={updateMutation.isPending || isGenerating}
          secondaryAction={{
            label: isGenerating ? 'Generating...' : 'Generate',
            onClick: handleGenerateDescription,
            disabled: isGenerating || updateMutation.isPending,
          }}
          primaryAction={{
            label: updateMutation.isPending ? 'Saving...' : 'Save',
            onClick: handleSave,
            disabled: updateMutation.isPending || isGenerating || !hasChanges,
          }}
        />
      </ChipModal>

      <ChipConfirmModal
        open={showUnsavedChangesAlert}
        onOpenChange={setShowUnsavedChangesAlert}
        srTitle='Unsaved Changes'
        title='Unsaved Changes'
        description='You have unsaved changes. Are you sure you want to discard them?'
        dismissLabel='Keep editing'
        confirm={{
          label: 'Discard Changes',
          onClick: handleDiscardChanges,
        }}
      />
    </>
  )
}
