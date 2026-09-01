'use client'

import { memo } from 'react'
import { SubflowNodeView } from '@sim/workflow-renderer'
import type { Node, NodeProps } from '@xyflow/react'

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
  return (
    <SubflowNodeView
      id={id}
      data={{ ...data, isPreview: true }}
      selected={false}
      isEnabled={data.enabled ?? true}
      isLocked={false}
      isFocused={false}
      nestingLevel={0}
      canEditWorkflow={false}
      onSelect={() => undefined}
    />
  )
}

export const PreviewSubflow = memo(WorkflowPreviewSubflowInner)
