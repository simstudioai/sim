'use client'

import { memo } from 'react'
import { cn } from '@sim/emcn'
import { SubflowNodeView } from '@sim/workflow-renderer'
import type { Node, NodeProps } from '@xyflow/react'
import { type CanvasPort, getCanvasPorts } from '@/lib/workflows/blocks/canvas-ports'
import type { BlockDiffStatus } from '@/lib/workflows/comparison'
import { DiffStatusLabel } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/components/diff-label/diff-label'
import { PreviewPortRows } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/components/port-rows/port-rows'
import { usePreviewPortInternals } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/use-preview-port-internals'

/** Execution status for subflows in preview mode */
type ExecutionStatus = 'success' | 'error' | 'not-executed'

interface WorkflowPreviewSubflowData extends Record<string, unknown> {
  name: string
  width?: number
  height?: number
  kind: 'loop' | 'parallel'
  parentId?: string
  /** Whether this subflow is enabled */
  enabled?: boolean
  /** Whether this subflow is selected in preview mode */
  isPreviewSelected?: boolean
  /** Execution status for highlighting the subflow container */
  executionStatus?: ExecutionStatus
  /** Comparison status when previewing a version diff */
  diffStatus?: BlockDiffStatus
  removedPorts?: CanvasPort[]
  /** Skips expensive computations for thumbnails/template previews (unused in subflow, for consistency) */
  lightweight?: boolean
}

/**
 * Preview subflow component for workflow visualization.
 * Renders loop/parallel containers without hooks, store subscriptions,
 * or interactive features.
 */
type WorkflowPreviewSubflowNode = Node<WorkflowPreviewSubflowData, 'subflowNode'>

function WorkflowPreviewSubflowInner({ data, id }: NodeProps<WorkflowPreviewSubflowNode>) {
  usePreviewPortInternals(id, [
    ...getCanvasPorts({ id, type: data.kind, subBlocks: {} }),
    ...(data.removedPorts ?? []),
  ])
  const view = (
    <SubflowNodeView
      id={id}
      data={{ ...data, isPreview: true }}
      selected={false}
      isEnabled={data.enabled ?? true}
      isLocked={false}
      isFocused={false}
      diffStatus={
        data.diffStatus === 'added' ? 'new' : data.diffStatus === 'modified' ? 'edited' : undefined
      }
      nestingLevel={0}
      canEditWorkflow={false}
      onSelect={() => undefined}
    />
  )
  if (!data.diffStatus && !data.removedPorts?.length) return view
  /* Same label as a card; a removed container fades like a removed card, its children ghost themselves. */
  return (
    <div className='relative'>
      {data.diffStatus && <DiffStatusLabel status={data.diffStatus} />}
      <div className={cn(data.diffStatus === 'removed' && 'opacity-45')}>{view}</div>
      {data.removedPorts?.length ? (
        <div className='absolute right-0 bottom-0 left-0'>
          <PreviewPortRows rows={data.removedPorts.map((row) => ({ ...row, removed: true }))} />
        </div>
      ) : null}
    </div>
  )
}

export const PreviewSubflow = memo(WorkflowPreviewSubflowInner)
