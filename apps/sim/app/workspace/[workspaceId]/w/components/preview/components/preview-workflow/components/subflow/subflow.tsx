'use client'

import { memo } from 'react'
import { SubflowNodeView } from '@sim/workflow-renderer'
import type { NodeProps } from 'reactflow'

/** Execution status for subflows in preview mode */
type ExecutionStatus = 'success' | 'error' | 'not-executed'

interface WorkflowPreviewSubflowData {
  name: string
  width?: number
  height?: number
  kind: 'loop' | 'parallel'
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
function WorkflowPreviewSubflowInner({ data, id }: NodeProps<WorkflowPreviewSubflowData>) {
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
