'use client'

import { memo } from 'react'
import { cn } from '@sim/emcn/lib/cn'
import type { Node, NodeProps } from '@xyflow/react'
import { SubflowNodeView } from '@/app/(product)/_components/workspace/workflows/canvas/subflow-node/subflow-node'
import { DiffStatusLabel } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-preview/diff-label'
import { PreviewPortRows } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-preview/port-rows'
import styles from '@/app/(product)/_components/workspace/workflows/canvas/workflow-preview/preview-subflow.module.css'
import { usePreviewPortInternals } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-preview/use-preview-port-internals'
import {
  type BlockDiffStatus,
  type CanvasPort,
  getCanvasPorts,
} from '@/platform/lib/data/workflows'

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
      canEditWorkflow={false}
      onSelect={() => undefined}
    />
  )
  if (!data.diffStatus && !data.removedPorts?.length) return view
  /* Same label as a card; a removed container fades like a removed card, its children ghost themselves. */
  return (
    <div className={styles.frame}>
      {data.diffStatus && <DiffStatusLabel status={data.diffStatus} />}
      <div className={cn(data.diffStatus === 'removed' && styles.removed)}>{view}</div>
      {data.removedPorts?.length ? (
        <div className={styles.footer}>
          <PreviewPortRows rows={data.removedPorts.map((row) => ({ ...row, removed: true }))} />
        </div>
      ) : null}
    </div>
  )
}

/** Read-only loop/parallel container for the workflow preview, painted by the canvas's own container view. */
export const PreviewSubflow = memo(WorkflowPreviewSubflowInner)
