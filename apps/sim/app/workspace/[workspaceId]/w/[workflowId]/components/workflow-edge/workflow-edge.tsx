import { memo, useMemo } from 'react'
import { X } from 'lucide-react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import type { EdgeDiffStatus } from '@/lib/workflows/diff/types'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'

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
  const isInsideLoop = data?.isInsideLoop ?? false
  const parentLoopId = data?.parentLoopId

  // Combined store subscription to reduce subscription overhead
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
  const edgeRunStatus = lastRunEdges.get(id)

  // Memoize diff status calculation to avoid recomputing on every render
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

  // Memoize edge style to prevent object recreation
  const edgeStyle = useMemo(() => {
    let color = 'var(--workflow-edge)'
    if (edgeDiffStatus === 'deleted') color = 'var(--text-error)'
    else if (isErrorEdge) color = 'var(--text-error)'
    else if (edgeDiffStatus === 'new') color = 'var(--brand-tertiary)'
    else if (edgeRunStatus === 'success') color = 'var(--border-success)'
    else if (edgeRunStatus === 'error') color = 'var(--text-error)'

    return {
      ...(style ?? {}),
      strokeWidth: edgeDiffStatus ? 3 : isSelected ? 2.5 : 2,
      stroke: color,
      strokeDasharray: edgeDiffStatus === 'deleted' ? '10,5' : undefined,
      opacity: edgeDiffStatus === 'deleted' ? 0.7 : isSelected ? 0.5 : 1,
    }
  }, [style, edgeDiffStatus, isSelected, isErrorEdge, edgeRunStatus])

  return (
    <>
      <BaseEdge
        path={edgePath}
        data-testid='workflow-edge'
        style={edgeStyle}
        interactionWidth={30}
        data-edge-id={id}
        data-parent-loop-id={parentLoopId}
        data-is-selected={isSelected ? 'true' : 'false'}
        data-is-inside-loop={isInsideLoop ? 'true' : 'false'}
      />
      {/* Animate dash offset for edge movement effect */}
      <animate
        attributeName='stroke-dashoffset'
        from={edgeDiffStatus === 'deleted' ? '15' : '10'}
        to='0'
        dur={edgeDiffStatus === 'deleted' ? '2s' : '1s'}
        repeatCount='indefinite'
      />

      {isSelected && (
        <EdgeLabelRenderer>
          <div
            className='nodrag nopan group flex h-[22px] w-[22px] cursor-pointer items-center justify-center transition-colors'
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 100,
            }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()

              if (data?.onDelete) {
                // Pass this specific edge's ID to the delete function
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

export const WorkflowEdge = memo(WorkflowEdgeComponent)
