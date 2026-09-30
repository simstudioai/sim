'use client'

import {
  Chip,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Check, ChevronDown } from '@sim/emcn/icons'
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
  onDirectionChange: (direction: ForkDirection) => void
}

/**
 * The link between two environments: how far apart they are, a running edge pointing the way
 * changes would flow, and a split button whose main half reviews that sync and whose chevron
 * turns it from a promotion into a refresh, reversing the edge.
 */
export function PipelineConnector({
  child,
  parent,
  direction,
  changeCount,
  focused,
  canManage,
  onReview,
  onDirectionChange,
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
        direction={promote ? 'forward' : 'backward'}
        label={
          promote
            ? `${child.label} flows into ${parent.label}`
            : `${parent.label} flows into ${child.label}`
        }
      />
      {canManage ? (
        <div
          className={cn(
            'flex items-center gap-px rounded-lg',
            focused && 'ring-2 ring-[var(--text-secondary)] ring-offset-2 ring-offset-[var(--bg)]'
          )}
        >
          <Chip variant='primary' className='rounded-r-none' onClick={onReview}>
            {promote ? 'Review promotion' : 'Review refresh'}
          </Chip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Chip
                variant='primary'
                leftIcon={ChevronDown}
                aria-label='Choose sync direction'
                className='rounded-l-none'
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='min-w-[240px]'>
              <DropdownMenuItem onSelect={() => onDirectionChange('push')}>
                <span className='flex-1'>
                  Promote {child.label} to {parent.label}
                </span>
                <Check className={cn('size-[14px]', !promote && 'invisible')} />
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onDirectionChange('pull')}>
                <span className='flex-1'>
                  Refresh {child.label} from {parent.label}
                </span>
                <Check className={cn('size-[14px]', promote && 'invisible')} />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  )
}
