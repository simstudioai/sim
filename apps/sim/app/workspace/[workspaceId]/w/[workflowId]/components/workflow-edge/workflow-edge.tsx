import { memo, useCallback, useMemo } from 'react'
import {
  type EdgeDiffStatus,
  type WorkflowEdge as WorkflowEdgeType,
  WorkflowEdgeView,
} from '@sim/workflow-renderer'
import { type EdgeProps, useStore } from '@xyflow/react'
import { useShallow } from 'zustand/react/shallow'
import {
  isEdgeConnectedToEditor,
  isEdgeHighlighted,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/edge-highlight'
import {
  useIsBlockActive,
  useIsCurrentWorkflowExecuting,
  useLastRunEdges,
} from '@/stores/execution'
import { usePanelEditorStore, usePanelStore } from '@/stores/panel'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'

type WorkflowEdgeProps = EdgeProps<WorkflowEdgeType>

/**
 * Editor container for {@link WorkflowEdgeView}.
 *
 * Reads the diff and execution stores, resolves the edge's diff/run state, and
 * passes it to the pure renderer shared with the docs preview.
 */
const WorkflowEdgeComponent = (props: WorkflowEdgeProps) => {
  const { id, data, source, target, sourceHandleId, targetHandleId } = props

  const { diffAnalysis, isShowingDiff, isDiffReady } = useWorkflowDiffStore(
    useShallow((state) => ({
      diffAnalysis: state.diffAnalysis,
      isShowingDiff: state.isShowingDiff,
      isDiffReady: state.isDiffReady,
    }))
  )
  const lastRunEdges = useLastRunEdges()
  const isWorkflowRunning = useIsCurrentWorkflowExecuting()
  const isTargetActive = useIsBlockActive(target)
  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const activeTab = usePanelStore((state) => state.activeTab)

  /**
   * Match the block ring: darken edges when an endpoint is canvas-selected or
   * open in the editor panel (same `--text-secondary` as the selection ring).
   */
  const isEndpointSelected = useStore(
    useCallback(
      (state) =>
        Boolean(state.nodeLookup.get(source)?.selected || state.nodeLookup.get(target)?.selected),
      [source, target]
    )
  )
  const isConnectedToSelection = Boolean(
    isEndpointSelected ||
      (data as { isConnectedToSelection?: boolean } | undefined)?.isConnectedToSelection
  )
  const isConnectedToEditor = isEdgeConnectedToEditor(
    activeTab === 'editor' ? currentBlockId : null,
    source,
    target
  )
  const shouldHighlightEdge = isEdgeHighlighted({
    isEndpointSelected: isConnectedToSelection,
    isConnectedToEditor,
  })

  const previewExecutionStatus = (
    data as { executionStatus?: 'success' | 'error' | 'not-executed' } | undefined
  )?.executionStatus
  const runStatus = previewExecutionStatus || lastRunEdges.get(id)

  const diffStatus = useMemo((): EdgeDiffStatus => {
    if (data?.isDeleted) return 'deleted'
    if (!diffAnalysis?.edge_diff || !isDiffReady) return null

    const actualSourceHandle = sourceHandleId || 'source'
    const actualTargetHandle = targetHandleId || 'target'
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
    sourceHandleId,
    targetHandleId,
  ])

  return (
    <WorkflowEdgeView
      {...props}
      diffStatus={diffStatus}
      runStatus={runStatus}
      isPreviewRun={Boolean(previewExecutionStatus)}
      isWorkflowRunning={isWorkflowRunning}
      isTargetActive={isTargetActive}
      isConnectedToSelection={shouldHighlightEdge}
    />
  )
}

export const WorkflowEdge = memo(WorkflowEdgeComponent)
