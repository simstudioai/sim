import { WorkflowEdgeView } from '@sim/workflow-renderer'
import type { Edge, EdgeProps } from '@xyflow/react'
import type { EdgeDiffStatus } from '@/lib/workflows/comparison'

interface PreviewEdgeData extends Record<string, unknown> {
  executionStatus?: 'success' | 'error' | 'not-executed'
  diffStatus?: EdgeDiffStatus
  isConnectedToSelection?: boolean
}

interface PreviewEdgeProps extends EdgeProps<Edge<PreviewEdgeData>> {}

/** Immutable previews take all visual state from their own snapshot. */
export function PreviewEdge(props: PreviewEdgeProps) {
  const { data } = props
  return (
    <WorkflowEdgeView
      {...props}
      diffStatus={
        data?.diffStatus === 'added' ? 'new' : data?.diffStatus === 'removed' ? 'ghost' : null
      }
      runStatus={data?.executionStatus}
      isPreviewRun={Boolean(data?.executionStatus)}
      isConnectedToSelection={data?.isConnectedToSelection}
    />
  )
}
