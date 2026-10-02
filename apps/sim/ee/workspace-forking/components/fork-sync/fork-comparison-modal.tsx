'use client'

import { ArrowRight } from '@sim/emcn/icons'
import type { ForkWorkflowComparison } from '@/lib/api/contracts/workspace-fork'
import { WorkflowComparisonModal } from '@/app/workspace/[workspaceId]/w/components/workflow-diff'
import { useDeploymentVersionState } from '@/hooks/queries/workflows'

export interface ForkComparisonSelection {
  sourceWorkflowId: string
  comparison: Extract<ForkWorkflowComparison, { status: 'available' }>
}

interface ForkComparisonModalProps extends ForkComparisonSelection {
  onClose: () => void
}

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
      header={
        <div className='flex items-center gap-2'>
          <span>Last Sync</span>
          <ArrowRight className='size-[14px] text-[var(--text-icon)]' />
          <span>Now</span>
        </div>
      }
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
