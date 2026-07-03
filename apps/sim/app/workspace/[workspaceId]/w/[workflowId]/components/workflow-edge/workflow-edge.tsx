import { memo, useMemo } from 'react'
import { type EdgeDiffStatus, WorkflowEdgeView } from '@sim/workflow-renderer'
import type { EdgeProps } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { useLastRunEdges } from '@/stores/execution'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'

/** Extended edge props with optional handle identifiers */
interface WorkflowEdgeProps extends EdgeProps {
  sourceHandle?: string | null
  targetHandle?: string | null
}

/**
 * Editor container for {@link WorkflowEdgeView}.
 *
 * Reads the diff and execution stores, resolves the edge's diff/run state, and
 * passes it to the pure renderer shared with the docs preview.
 */
const WorkflowEdgeComponent = (props: WorkflowEdgeProps) => {
  const { id, data, source, target, sourceHandle, targetHandle } = props

  const { diffAnalysis, isShowingDiff, isDiffReady } = useWorkflowDiffStore(
    useShallow((state) => ({
      diffAnalysis: state.diffAnalysis,
      isShowingDiff: state.isShowingDiff,
      isDiffReady: state.isDiffReady,
    }))
  )
  const lastRunEdges = useLastRunEdges()

  const previewExecutionStatus = (
    data as { executionStatus?: 'success' | 'error' | 'not-executed' } | undefined
  )?.executionStatus
  const runStatus = previewExecutionStatus || lastRunEdges.get(id)

  const diffStatus = useMemo((): EdgeDiffStatus => {
    if (data?.isDeleted) return 'deleted'
    if (!diffAnalysis?.edge_diff || !isDiffReady) return null

    const actualSourceHandle = sourceHandle || 'source'
    const actualTargetHandle = targetHandle || 'target'
    const edgeIdentifier = `${source}-${actualSourceHandle}-${target}-${actualTargetHandle}`

    if (isShowingDiff) {
      if (diffAnalysis.edge_diff.new_edges.includes(edgeIdentifier)) return 'new'
      if (diffAnalysis.edge_diff.unchanged_edges.includes(edgeIdentifier)) return 'unchanged'
    } else {
      if (diffAnalysis.edge_diff.deleted_edges.includes(edgeIdentifier)) return 'deleted'
    }
    return null
  }, [
    data?.isDeleted,
    diffAnalysis,
    isDiffReady,
    isShowingDiff,
    source,
    target,
    sourceHandle,
    targetHandle,
  ])

  return (
    <WorkflowEdgeView
      {...props}
      diffStatus={diffStatus}
      runStatus={runStatus}
      isPreviewRun={Boolean(previewExecutionStatus)}
    />
  )
}

export const WorkflowEdge = memo(WorkflowEdgeComponent)
