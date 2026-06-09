'use client'

import { useRef, useState } from 'react'
import {
  Chip,
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
            type='custom'
            title={
              <div className='flex items-center justify-between'>
                <span>
                  {currentDescription ? 'Edit the' : 'Add a'} description for{' '}
                  <span className='font-medium text-[var(--text-primary)]'>{versionName}</span>
                </span>
                <Chip
                  variant='filled'
                  flush
                  onClick={handleGenerateDescription}
                  disabled={isGenerating || updateMutation.isPending}
                >
                  {isGenerating ? 'Generating...' : 'Generate'}
                </Chip>
              </div>
            }
            flush
          >
            <div className='flex flex-col gap-1.5'>
              <textarea
                placeholder='Describe the changes in this deployment version...'
                className='min-h-[120px] w-full resize-none rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 py-2 font-medium font-sans text-[var(--text-primary)] text-sm outline-none transition-colors placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[var(--surface-4)]'
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                disabled={isGenerating}
              />
              <p className='text-right text-[var(--text-tertiary)] text-xs'>
                {description.length}/2000
              </p>
            </div>
          </ChipModalField>
          <ChipModalError>
            {updateMutation.error?.message || generateMutation.error?.message}
          </ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={handleCloseAttempt}
          cancelDisabled={updateMutation.isPending || isGenerating}
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
