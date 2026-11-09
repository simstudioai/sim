import type { Edge, EdgeProps } from '@xyflow/react'
import { WorkflowEdgeView } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-edge/workflow-edge'
import type { VersionEdgeDiffStatus } from '@/platform/lib/data/workflows'

interface PreviewEdgeData extends Record<string, unknown> {
  executionStatus?: 'success' | 'error' | 'not-executed'
  diffStatus?: VersionEdgeDiffStatus
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
