'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  cn,
  OverflowText,
  Skeleton,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import {
  buildWorkflowDiffOverlay,
  generateWorkflowDiffSummary,
  omitPresentationChanges,
} from '@/lib/workflows/comparison'
import { PreviewWorkflow } from '@/app/workspace/[workspaceId]/w/components/preview'
import { getPreviewBlockDimensions } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/preview-dimensions'
import { ChangeList } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const CHANGE_LIST_WIDTH_CLASS = 'w-[440px] max-w-[45%]'

/** The two empty panes a host shows while it loads the sides of a comparison. */
export function WorkflowDiffSkeleton() {
  return (
    <div className='flex h-full'>
      <Skeleton className='h-full flex-1 rounded-none' />
      <Skeleton
        className={cn(
          CHANGE_LIST_WIDTH_CLASS,
          'h-full rounded-none border-[var(--border)] border-l'
        )}
      />
    </div>
  )
}

interface WorkflowDiffViewProps {
  /** The older or source side of the comparison */
  baseState: WorkflowState
  /** The newer or destination side; the canvas paints this one */
  targetState: WorkflowState
  /** Shown in the strip above the panes; omit when the host already names the sides */
  baseLabel?: string
  targetLabel?: string
}

/**
 * Side-by-side comparison of two workflow states: the target canvas on the
 * left with every touched block ringed and every removed one ghosted, the
 * change list on the right. Selection is shared between the two panes.
 */
export function WorkflowDiffView({
  baseState,
  targetState,
  baseLabel,
  targetLabel,
}: WorkflowDiffViewProps) {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null)
  const listEdges = useScrollEdges(listElement)

  const summary = useMemo(
    () => omitPresentationChanges(generateWorkflowDiffSummary(targetState, baseState)),
    [targetState, baseState]
  )
  const overlay = useMemo(
    () => buildWorkflowDiffOverlay(summary, baseState, targetState, getPreviewBlockDimensions),
    [summary, baseState, targetState]
  )
  const containers = useMemo(
    () => ({ base: baseState, target: targetState }),
    [baseState, targetState]
  )

  const handleNodeClick = (blockId: string) => {
    setSelectedBlockId((current) => (current === blockId ? null : blockId))
  }
  const handlePaneClick = useCallback(() => setSelectedBlockId(null), [])

  // A reconfigured container counts as modified even when no field of its own changed.
  const modifiedCount = new Set([
    ...summary.modifiedBlocks.map((block) => block.id),
    ...summary.containerChanges.map((container) => container.id),
  ]).size
  const variableCount =
    summary.variableChanges.added +
    summary.variableChanges.removed +
    summary.variableChanges.modified
  const connectionCount = summary.edgeChanges.added + summary.edgeChanges.removed
  const counts = [
    { label: 'added', value: summary.addedBlocks.length, className: 'text-[var(--brand-accent)]' },
    { label: 'modified', value: modifiedCount, className: 'text-[var(--warning)]' },
    {
      label: 'removed',
      value: summary.removedBlocks.length,
      className: 'text-[var(--text-error)]',
    },
    {
      label: connectionCount === 1 ? 'connection' : 'connections',
      value: connectionCount,
      className: 'text-[var(--text-tertiary)]',
    },
    {
      label: variableCount === 1 ? 'variable' : 'variables',
      value: variableCount,
      className: 'text-[var(--text-tertiary)]',
    },
  ].filter((count) => count.value > 0)

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex h-[40px] shrink-0 items-center gap-3 border-[var(--border)] border-b px-4'>
        {baseLabel && targetLabel && (
          <div className='flex min-w-0 items-center gap-2 text-small'>
            <OverflowText label={baseLabel} className='text-[var(--text-secondary)]' />
            <ArrowRight className='size-[12px] shrink-0 text-[var(--text-icon)]' />
            <OverflowText label={targetLabel} className='font-medium text-[var(--text-primary)]' />
          </div>
        )}
        <div className='ml-auto flex items-center gap-3 text-caption tabular-nums'>
          {summary.hasChanges ? (
            counts.map((count) => (
              <span key={count.label} className={count.className}>
                {count.value} {count.label}
              </span>
            ))
          ) : (
            <span className='text-[var(--text-tertiary)]'>No changes</span>
          )}
        </div>
      </div>

      <div className='flex min-h-0 flex-1'>
        <div className='h-full min-w-0 flex-1'>
          <PreviewWorkflow
            workflowState={overlay.mergedState}
            blockDiffStatus={overlay.blockStatus}
            edgeDiffStatus={overlay.edgeStatus}
            changedFieldsByBlock={overlay.changedFieldsByBlock}
            removedPortsByBlock={overlay.removedPortsByBlock}
            selectedBlockId={selectedBlockId}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            isPannable
            cursorStyle='pointer'
            defaultZoom={0.8}
          />
        </div>
        <div
          ref={setListElement}
          className={cn(
            CHANGE_LIST_WIDTH_CLASS,
            scrollFadeClass,
            'h-full shrink-0 overflow-y-auto border-[var(--border)] border-l bg-[var(--surface-1)]'
          )}
          {...scrollFadeAttributes(listEdges)}
        >
          <ChangeList
            summary={summary}
            baseBlocks={baseState.blocks}
            targetBlocks={targetState.blocks}
            containers={containers}
            selectedBlockId={selectedBlockId}
            onSelectBlock={setSelectedBlockId}
          />
        </div>
      </div>
    </div>
  )
}
