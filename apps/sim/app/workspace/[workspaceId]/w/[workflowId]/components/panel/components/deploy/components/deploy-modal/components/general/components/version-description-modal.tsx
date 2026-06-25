'use client'

import { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import {
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  chipFieldSurfaceClass,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  useGenerateVersionDescription,
  useUpdateDeploymentVersion,
} from '@/hooks/queries/deployments'

const RichMarkdownField = dynamic(
  () =>
    import(
      '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-field'
    ).then((m) => m.RichMarkdownField),
  {
    ssr: false,
    loading: () => <div className={cn('min-h-[240px]', chipFieldSurfaceClass)} />,
  }
)

/** A high cap that only guards against abuse — no visible counter; normal descriptions never reach it. */
const MAX_DESCRIPTION_LENGTH = 50_000

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
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const initialDescriptionRef = useRef(currentDescription || '')
  const [description, setDescription] = useState(initialDescriptionRef.current)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)

  const updateMutation = useUpdateDeploymentVersion()
  const generateMutation = useGenerateVersionDescription()

  const hasChanges = description.trim() !== initialDescriptionRef.current.trim()
  const isGenerating = generateMutation.isPending
  const isTooLong = description.length > MAX_DESCRIPTION_LENGTH

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
    if (!workflowId || isTooLong) return

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
          >
            <RichMarkdownField
              value={description}
              onChange={setDescription}
              placeholder='Describe the changes in this deployment version...'
              minHeight={240}
              maxHeight={420}
              disabled={isGenerating}
              isStreaming={isGenerating}
              error={description.length > MAX_DESCRIPTION_LENGTH}
              workspaceId={workspaceId}
            />
          </ChipModalField>
          <ChipModalError>
            {updateMutation.error?.message || generateMutation.error?.message}
          </ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={handleCloseAttempt}
          cancelDisabled={updateMutation.isPending || isGenerating}
          secondaryActions={[
            {
              label: isGenerating ? 'Generating...' : 'Generate',
              onClick: handleGenerateDescription,
              disabled: isGenerating || updateMutation.isPending,
            },
          ]}
          primaryAction={{
            label: updateMutation.isPending ? 'Saving...' : 'Save',
            onClick: handleSave,
            disabled: updateMutation.isPending || isGenerating || !hasChanges || isTooLong,
          }}
        />
      </ChipModal>

      <ChipConfirmModal
        open={showUnsavedChangesAlert}
        onOpenChange={setShowUnsavedChangesAlert}
        srTitle='Unsaved Changes'
        title='Unsaved Changes'
        text='You have unsaved changes. Are you sure you want to discard them?'
        dismissLabel='Keep editing'
        confirm={{
          label: 'Discard Changes',
          onClick: handleDiscardChanges,
        }}
      />
    </>
  )
}
