'use client'

import { useId } from 'react'
import { ChipModal, ChipModalBody, ChipModalHeader } from '@sim/emcn'
import { Preview } from '@/app/workspace/[workspaceId]/w/components/preview'
import { useDeploymentVersionState } from '@/hooks/queries/workflows'

interface WorkflowVersionPreviewProps {
  workflowId: string
  version: number
  title: string
  onClose: () => void
}

/** A deployed workflow version on a read-only canvas, as the deploy modal shows it. */
export function WorkflowVersionPreview({
  workflowId,
  version,
  title,
  onClose,
}: WorkflowVersionPreviewProps) {
  const descriptionId = useId()
  const { data: workflowState, error } = useDeploymentVersionState(workflowId, version)
  return (
    <ChipModal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      srTitle='Workflow preview'
      aria-describedby={descriptionId}
      size='full'
      className='h-[90vh] [&>div]:h-full'
    >
      <ChipModalHeader onClose={onClose}>{title}</ChipModalHeader>
      <ChipModalBody fullBleed>
        <p id={descriptionId} className='sr-only'>
          Visual preview of the workflow version this test ran against.
        </p>
        {error ? (
          <p role='alert' className='p-6 text-[var(--text-error)] text-small'>
            {error.message}
          </p>
        ) : workflowState ? (
          <Preview workflowState={workflowState} autoSelectLeftmost />
        ) : null}
      </ChipModalBody>
    </ChipModal>
  )
}
