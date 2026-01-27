import { memo, useMemo } from 'react'
import { X } from 'lucide-react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import type { EdgeDiffStatus } from '@/lib/workflows/diff/types'
import { useExecutionStore } from '@/stores/execution'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'

/** Extended edge props with optional handle identifiers */
interface WorkflowEdgeProps extends EdgeProps {
  sourceHandle?: string | null
  targetHandle?: string | null
}

const WorkflowEdgeComponent = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  source,
  target,
  sourceHandle,
  targetHandle,
}: WorkflowEdgeProps) => {
  const isHorizontal = sourcePosition === 'right' || sourcePosition === 'left'

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
    offset: isHorizontal ? 30 : 20,
  })

  const isSelected = data?.isSelected ?? false

  const { diffAnalysis, isShowingDiff, isDiffReady } = useWorkflowDiffStore(
    useShallow((state) => ({
      diffAnalysis: state.diffAnalysis,
      isShowingDiff: state.isShowingDiff,
      isDiffReady: state.isDiffReady,
    }))
  )
  const lastRunEdges = useExecutionStore((state) => state.lastRunEdges)

  const dataSourceHandle = (data as { sourceHandle?: string } | undefined)?.sourceHandle
  const isErrorEdge = (sourceHandle ?? dataSourceHandle) === 'error'
  const previewExecutionStatus = (
    data as { executionStatus?: 'success' | 'error' | 'not-executed' } | undefined
  )?.executionStatus
  const edgeRunStatus = previewExecutionStatus || lastRunEdges.get(id)

  const edgeDiffStatus = useMemo((): EdgeDiffStatus => {
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

  const edgeStyle = useMemo(() => {
    let color = 'var(--workflow-edge)'
    let opacity = 1

    if (edgeDiffStatus === 'deleted') {
      color = 'var(--text-error)'
      opacity = 0.7
    } else if (edgeDiffStatus === 'new') {
      color = 'var(--brand-tertiary-2)'
    } else if (edgeRunStatus === 'success') {
      // Use green for preview mode, default for canvas execution
      // This also applies to error edges that were taken (error path executed)
      color = previewExecutionStatus ? 'var(--brand-tertiary-2)' : 'var(--border-success)'
    } else if (edgeRunStatus === 'error') {
      color = 'var(--text-error)'
    } else if (isErrorEdge) {
      // Error edges that weren't taken stay red
      color = 'var(--text-error)'
    }

    if (isSelected) {
      opacity = 0.5
    }

    return {
      ...(style ?? {}),
      strokeWidth: edgeDiffStatus
        ? 3
        : edgeRunStatus === 'success' || edgeRunStatus === 'error'
          ? 2.5
          : isSelected
            ? 2.5
            : 2,
      stroke: color,
      strokeDasharray: edgeDiffStatus === 'deleted' ? '10,5' : undefined,
      opacity,
    }
  }, [style, edgeDiffStatus, isSelected, isErrorEdge, edgeRunStatus, previewExecutionStatus])

  return (
    <>
      <BaseEdge path={edgePath} style={edgeStyle} interactionWidth={30} />

      {isSelected && (
        <EdgeLabelRenderer>
          <div
            className='nodrag nopan group flex h-[22px] w-[22px] cursor-pointer items-center justify-center transition-colors'
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 100,
            }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()

              if (data?.onDelete) {
                data.onDelete(id)
              }
            }}
          >
            <X className='h-4 w-4 text-[var(--text-error)] transition-colors group-hover:text-[var(--text-error)]/80' />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

/**
 * Workflow edge component with execution status and diff visualization.
 *
 * @remarks
 * Edge coloring priority:
 * 1. Diff status (deleted/new) - for version comparison
 * 2. Execution status (success/error) - for run visualization
 * 3. Error edge default (red) - for untaken error paths
 * 4. Default edge color - normal workflow connections
 */
export const WorkflowEdge = memo(WorkflowEdgeComponent)
