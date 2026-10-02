'use client'

import type { ForkWorkflowComparison } from '@/lib/api/contracts/workspace-fork'
import { WorkflowComparisonModal } from '@/app/workspace/[workspaceId]/w/components/workflow-diff'
import { useDeploymentVersionState } from '@/hooks/queries/workflows'

/** Pins the last synced and proposed deployment identities within one source workflow. */
export interface ForkComparisonSelection {
  sourceWorkflowId: string
  comparison: Extract<ForkWorkflowComparison, { status: 'available' }>
}

interface ForkComparisonModalProps extends ForkComparisonSelection {
  onClose: () => void
}

/** Loads the pinned source snapshots; missing or replaced versions remain explicit load errors. */
export function ForkComparisonModal({
  sourceWorkflowId,
  comparison,
  onClose,
}: ForkComparisonModalProps) {
  const base = useDeploymentVersionState(
    sourceWorkflowId,
    comparison.base.version,
    comparison.base.id
  )
  const target = useDeploymentVersionState(
    sourceWorkflowId,
    comparison.target.version,
    comparison.target.id
  )
  return (
    <WorkflowComparisonModal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      header='Compare versions'
      baseState={base.data ?? null}
      targetState={target.data ?? null}
      isLoading={base.isLoading || target.isLoading}
      error={base.error ?? target.error}
      comparisonKey={`${comparison.base.id}:${comparison.target.id}`}
      baseLabel='Last Sync'
      targetLabel='Now'
    />
  )
}
