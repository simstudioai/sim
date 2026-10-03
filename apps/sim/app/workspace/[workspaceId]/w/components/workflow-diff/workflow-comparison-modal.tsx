'use client'

import { type ReactNode, useId } from 'react'
import { ChipModal, ChipModalBody, ChipModalHeader } from '@sim/emcn'
import {
  WorkflowDiffSkeleton,
  WorkflowDiffView,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/workflow-diff-view'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface WorkflowComparisonModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  header: ReactNode
  baseState: WorkflowState | null
  targetState: WorkflowState | null
  isLoading: boolean
  error?: Error | null
  comparisonKey: string
  baseLabel?: string
  targetLabel?: string
}

/**
 * Renders caller-loaded snapshots once both are ready, with errors taking precedence.
 * Changing comparisonKey resets selection in the shared diff view.
 */
export function WorkflowComparisonModal({
  open,
  onOpenChange,
  header,
  baseState,
  targetState,
  isLoading,
  error,
  comparisonKey,
  baseLabel,
  targetLabel,
}: WorkflowComparisonModalProps) {
  const descriptionId = useId()
  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle='Compare versions'
      aria-describedby={descriptionId}
      size='full'
      className='h-[84vh] [&>div]:h-full'
    >
      <ChipModalHeader onClose={() => onOpenChange(false)}>{header}</ChipModalHeader>
      <ChipModalBody fullBleed>
        <p id={descriptionId} className='sr-only'>
          Blocks, fields and connections that differ between the two selected versions.
        </p>
        {error ? (
          <div className='flex h-full items-center justify-center text-[var(--text-error)] text-small'>
            {error.message || 'Could not load one of the versions.'}
          </div>
        ) : isLoading || !baseState || !targetState ? (
          <WorkflowDiffSkeleton />
        ) : (
          <WorkflowDiffView
            key={comparisonKey}
            baseState={baseState}
            targetState={targetState}
            baseLabel={baseLabel}
            targetLabel={targetLabel}
          />
        )}
      </ChipModalBody>
    </ChipModal>
  )
}
