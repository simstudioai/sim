'use client'

import { useEffect, useRef, useState } from 'react'
import { TextAreaField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import {
  useGenerateVersionDescription,
  useUpdateDeploymentVersion,
} from '@/platform/lib/data/workflow-deploy'
import { LOCALE } from '@/platform/shared/time'

/** A high cap that only guards against abuse; the message appears only once it is exceeded. */
const MAX_DESCRIPTION_LENGTH = 50_000

interface VersionDescriptionProps {
  workflowId: string
  version: number
  /** The version as the list names it, such as `v3 · Launch`. */
  versionLabel: string
  currentDescription: string | null | undefined
  onClose: () => void
}

/**
 * A deployment version's description: written by hand or generated from what changed since the
 * version before it, streamed into the field. Leaving with unsaved changes asks first.
 */
export function VersionDescription({
  workflowId,
  version,
  versionLabel,
  currentDescription,
  onClose,
}: VersionDescriptionProps) {
  const initial = currentDescription || ''
  const [description, setDescription] = useState(initial)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const updateMutation = useUpdateDeploymentVersion()
  const generateMutation = useGenerateVersionDescription()
  const generateAbort = useRef<AbortController | null>(null)
  const saved = useRef(false)

  const isGenerating = generateMutation.isPending
  const hasChanges = description.trim() !== initial.trim()
  const isTooLong = description.length > MAX_DESCRIPTION_LENGTH

  // A generation still streaming when the dialog goes away stops instead of running to the end.
  useEffect(() => () => generateAbort.current?.abort(), [])

  const closeAttempt = () => {
    if (updateMutation.isPending || isGenerating) return
    if (hasChanges) setConfirmingDiscard(true)
    else onClose()
  }

  const generate = () => {
    generateAbort.current?.abort()
    const controller = new AbortController()
    generateAbort.current = controller
    generateMutation.mutate({
      workflowId,
      version,
      signal: controller.signal,
      onStreamChunk: setDescription,
    })
  }

  const generateError =
    generateMutation.error && generateMutation.error.name !== 'AbortError'
      ? generateMutation.error.message || 'Failed to generate a description'
      : undefined

  return (
    <>
      <Modal
        open
        onOpenChange={(next) => {
          if (next) return
          if (saved.current) onClose()
          else closeAttempt()
        }}
        title='Version description'
        description={`${currentDescription ? 'Edit the' : 'Add a'} description for ${versionLabel}`}
        confirmLabel='Save'
        confirmDisabled={isGenerating || !hasChanges || isTooLong}
        pending={isGenerating}
        submitOnEnter={false}
        footerStartAction={{
          label: isGenerating ? 'Generating…' : 'Generate',
          icon: 'sparkles',
          variant: 'quiet',
          disabled: isGenerating || updateMutation.isPending,
          onClick: generate,
        }}
        onConfirm={async () => {
          if (isTooLong) return false
          await updateMutation.mutateAsync({
            workflowId,
            version,
            description: description.trim() || null,
          })
          saved.current = true
        }}
      >
        <TextAreaField
          label='Description'
          placeholder='Describe the changes in this deployment version'
          value={description}
          onChange={setDescription}
          defaultSize='large'
          disabled={isGenerating}
          error={
            isTooLong
              ? `Description exceeds the ${MAX_DESCRIPTION_LENGTH.toLocaleString(LOCALE)}-character limit (currently ${description.length.toLocaleString(LOCALE)})`
              : generateError
          }
        />
      </Modal>
      <ConfirmDialog
        target={confirmingDiscard}
        onClose={() => setConfirmingDiscard(false)}
        title='Discard changes?'
        description='You have unsaved changes to this description.'
        confirmLabel='Discard changes'
        pendingLabel='Discarding…'
        onConfirm={() => {
          setConfirmingDiscard(false)
          onClose()
        }}
      />
    </>
  )
}
