'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
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
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
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

  const generateAbortRef = useRef<AbortController | null>(null)
  /**
   * Abort an in-flight generation if the modal unmounts mid-stream (e.g. the deploy modal closes), so
   * the SSE stream stops instead of running to completion against a gone component.
   */
  useEffect(() => () => generateAbortRef.current?.abort(), [])

  const handleGenerateDescription = () => {
    generateAbortRef.current?.abort()
    const controller = new AbortController()
    generateAbortRef.current = controller
    generateMutation.mutate({
      workflowId,
      version,
      signal: controller.signal,
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
        srTitle={tI18n('version_description')}
      >
        <ChipModalHeader onClose={() => handleCloseAttempt()}>
          {t('version_description')}
        </ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='custom'
            title={
              <span>
                {currentDescription ? tI18n('edit_the') : tI18n('add_a')} {t('description_for')}{' '}
                <span className='font-medium text-[var(--text-primary)]'>{versionName}</span>
              </span>
            }
          >
            <RichMarkdownField
              value={description}
              onChange={setDescription}
              placeholder={t('describe_the_changes_in_this_deployment')}
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
        srTitle={tI18n('unsaved_changes')}
        title={t('unsaved_changes')}
        text={tI18n('you_have_unsaved_changes_are_you')}
        dismissLabel={tI18n('keep_editing')}
        confirm={{
          label: 'Discard Changes',
          onClick: handleDiscardChanges,
        }}
      />
    </>
  )
}
