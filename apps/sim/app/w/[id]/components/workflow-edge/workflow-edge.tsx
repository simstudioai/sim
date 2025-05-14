import { X } from 'lucide-react'
import { BaseEdge, EdgeLabelRenderer, EdgeProps, getSmoothStepPath } from 'reactflow'

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
}: EdgeProps) => {
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

  // Check if this edge is selected using the enhanced selection state
  const isSelected = data?.selectedEdgeInfo?.id === id;
  const isInsideLoop = data?.isInsideLoop;

  // Merge any style props passed from parent
  const edgeStyle = {
    strokeWidth: isSelected ? 2.5 : 2,
    stroke: isSelected ? '#475569' : '#94a3b8',
    strokeDasharray: '5,5',
    zIndex: isInsideLoop ? 100 : -10,
    ...style
  };

  return (
    <>
      <BaseEdge
        path={edgePath}
        data-testid="workflow-edge"
        style={edgeStyle}
        interactionWidth={20}
      />
      <animate
        attributeName="stroke-dashoffset"
        from="10"
        to="0"
        dur="1s"
        repeatCount="indefinite"
      />

      {isSelected && (
        <EdgeLabelRenderer>
          <div
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-[#FAFBFC] nodrag nopan shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 1000,
            }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (data?.onDelete) {
                data.onDelete(id)
              }
            }}
          >
            <X className="h-5 w-5 text-red-500 hover:text-red-600" />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
