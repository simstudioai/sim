'use client'

import { Chip } from '@sim/emcn'
import type { EnvironmentColumn } from '@/app/o/[organizationId]/p/components/environments/mapping-model'
import { PipelineEdge } from '@/app/o/[organizationId]/p/components/environments/pipeline-edge'
import type { ForkDirection } from '@/ee/workspace-forking/hooks/workspace-fork'

interface PipelineConnectorProps {
  /** The fork on the left; changes are promoted from it and refreshed into it. */
  child: EnvironmentColumn
  /** The environment it was forked from, on the right. */
  parent: EnvironmentColumn
  /** `push` promotes the child into the parent; `pull` refreshes the child from it. */
  direction: ForkDirection
  /** How many deployed workflows this direction would change; undefined while loading. */
  changeCount: number | undefined
  /** This edge's changes are the ones shown below the pipeline. */
  focused: boolean
  canManage: boolean
  onReview: () => void
}

/** Selects the environment pair reviewed below and shows its current sync direction. */
export function PipelineConnector({
  child,
  parent,
  direction,
  changeCount,
  focused,
  canManage,
  onReview,
}: PipelineConnectorProps) {
  const promote = direction === 'push'
  const drift =
    changeCount === undefined
      ? 'Comparing…'
      : changeCount === 0
        ? 'In sync'
        : `${changeCount} ${changeCount === 1 ? 'change' : 'changes'} to ${promote ? 'promote' : 'refresh'}`
  return (
    <div className='flex w-[190px] shrink-0 flex-col items-center justify-center gap-2.5 px-2'>
      <span className='rounded-full bg-[var(--surface-4)] px-2 py-0.5 text-[var(--text-secondary)] text-caption'>
        {drift}
      </span>
      <PipelineEdge
        animated={focused}
        direction={promote ? 'forward' : 'backward'}
        label={
          promote
            ? `${child.label} flows into ${parent.label}`
            : `${parent.label} flows into ${child.label}`
        }
      />
      {canManage ? (
        <Chip
          active={focused}
          aria-pressed={focused}
          aria-label={`Review sync between ${child.label} and ${parent.label}`}
          onClick={onReview}
        >
          Review
        </Chip>
      ) : null}
    </div>
  )
}
