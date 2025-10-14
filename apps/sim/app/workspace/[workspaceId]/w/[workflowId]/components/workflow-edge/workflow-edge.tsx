import { X } from 'lucide-react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from 'reactflow'
import type { EdgeDiffStatus } from '@/lib/workflows/diff/types'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'

interface WorkflowEdgeProps extends EdgeProps {
  sourceHandle?: string | null
  targetHandle?: string | null
}

export const WorkflowEdge = ({
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

  const diffAnalysis = useWorkflowDiffStore((state) => state.diffAnalysis)
  const isShowingDiff = useWorkflowDiffStore((state) => state.isShowingDiff)
  const isDiffReady = useWorkflowDiffStore((state) => state.isDiffReady)

  const generateEdgeIdentity = (
    sourceId: string,
    targetId: string,
    sourceHandle?: string | null,
    targetHandle?: string | null
  ): string => {
    const actualSourceHandle = sourceHandle || 'source'
    const actualTargetHandle = targetHandle || 'target'
    return `${sourceId}-${actualSourceHandle}-${targetId}-${actualTargetHandle}`
  }

  const edgeIdentifier = generateEdgeIdentity(source, target, sourceHandle, targetHandle)

  let edgeDiffStatus: EdgeDiffStatus = null

  if (data?.isDeleted) {
    edgeDiffStatus = 'deleted'
  } else if (diffAnalysis?.edge_diff && edgeIdentifier && isDiffReady) {
    if (isShowingDiff) {
      if (diffAnalysis.edge_diff.new_edges.includes(edgeIdentifier)) {
        edgeDiffStatus = 'new'
      } else if (diffAnalysis.edge_diff.unchanged_edges.includes(edgeIdentifier)) {
        edgeDiffStatus = 'unchanged'
      }
    } else {
      if (diffAnalysis.edge_diff.deleted_edges.includes(edgeIdentifier)) {
        edgeDiffStatus = 'deleted'
      }
    }
  }

  const getEdgeColor = () => {
    if (edgeDiffStatus === 'new') return '#22c55e' // Green for new edges
    if (edgeDiffStatus === 'deleted') return '#ef4444' // Red for deleted edges
    if (isSelected) return '#475569'
    return '#94a3b8'
  }

  const edgeStyle = {
    strokeWidth: edgeDiffStatus ? 3 : isSelected ? 2.5 : 2,
    stroke: getEdgeColor(),
    strokeDasharray: edgeDiffStatus === 'deleted' ? '10,5' : '5,5', // Longer dashes for deleted
    opacity: edgeDiffStatus === 'deleted' ? 0.7 : 1,
    ...style,
  }

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
            className='nodrag nopan flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-[#FAFBFC] shadow-sm'
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
            <X className='h-5 w-5 text-red-500 hover:text-red-600' />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
