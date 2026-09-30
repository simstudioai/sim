'use client'

import { useCallback, useMemo, useState } from 'react'
import { cn } from '@sim/emcn'
import { buildWorkflowDiffOverlay, generateWorkflowDiffSummary } from '@/lib/workflows/comparison'
import { PreviewWorkflow } from '@/app/workspace/[workspaceId]/w/components/preview'
import { ChangeList } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list'
import { omitPresentationChanges } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/** The change list pane and the skeleton that stands in for it share one width. */
export const CHANGE_LIST_WIDTH_CLASS = 'w-[440px] max-w-[45%]'

interface WorkflowDiffViewProps {
  /** The older or source side of the comparison */
  baseState: WorkflowState
  /** The newer or destination side; the canvas paints this one */
  targetState: WorkflowState
  /** Shown in the strip above the panes; omit when the host already names the sides */
  baseLabel?: string
  targetLabel?: string
  /** The sides live in different workspaces; set workspace-bound fields apart, muted */
  environmentBindings?: boolean
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
  environmentBindings = false,
}: WorkflowDiffViewProps) {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)

  const summary = useMemo(
    () => omitPresentationChanges(generateWorkflowDiffSummary(targetState, baseState)),
    [targetState, baseState]
  )
  const overlay = useMemo(
    () => buildWorkflowDiffOverlay(summary, baseState, targetState),
    [summary, baseState, targetState]
  )

  const handleNodeClick = useCallback((blockId: string) => {
    setSelectedBlockId((current) => (current === blockId ? null : blockId))
  }, [])
  const handlePaneClick = useCallback(() => setSelectedBlockId(null), [])

  const counts = [
    { label: 'added', value: summary.addedBlocks.length, className: 'text-[var(--brand-accent)]' },
    { label: 'modified', value: summary.modifiedBlocks.length, className: 'text-[var(--warning)]' },
    {
      label: 'removed',
      value: summary.removedBlocks.length,
      className: 'text-[var(--text-error)]',
    },
  ].filter((count) => count.value > 0)

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex h-[40px] shrink-0 items-center gap-3 border-[var(--border)] border-b px-4'>
        {baseLabel && targetLabel && (
          <div className='flex min-w-0 items-center gap-2 text-small'>
            <span className='truncate text-[var(--text-secondary)]'>{baseLabel}</span>
            <span className='text-[var(--text-muted)]'>→</span>
            <span className='truncate font-medium text-[var(--text-primary)]'>{targetLabel}</span>
          </div>
        )}
        <div className='ml-auto flex items-center gap-3 text-caption tabular-nums'>
          {counts.length === 0 ? (
            <span className='text-[var(--text-tertiary)]'>No changes</span>
          ) : (
            counts.map((count) => (
              <span key={count.label} className={count.className}>
                {count.value} {count.label}
              </span>
            ))
          )}
          {(summary.edgeChanges.added > 0 || summary.edgeChanges.removed > 0) && (
            <span className='text-[var(--text-tertiary)]'>
              {summary.edgeChanges.added + summary.edgeChanges.removed} connections
            </span>
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
            selectedBlockId={selectedBlockId}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            isPannable
            cursorStyle='pointer'
            defaultZoom={0.8}
          />
        </div>
        <div
          className={cn(
            CHANGE_LIST_WIDTH_CLASS,
            'h-full shrink-0 overflow-y-auto border-[var(--border)] border-l bg-[var(--surface-1)]'
          )}
        >
          <ChangeList
            summary={summary}
            baseBlocks={baseState.blocks}
            targetBlocks={targetState.blocks}
            selectedBlockId={selectedBlockId}
            onSelectBlock={setSelectedBlockId}
            environmentBindings={environmentBindings}
          />
        </div>
      </div>
    </div>
  )
}
