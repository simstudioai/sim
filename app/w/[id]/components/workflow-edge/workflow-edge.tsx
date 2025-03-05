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

  const isSelected = id === data?.selectedEdgeId

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          strokeWidth: 2,
          stroke: isSelected ? '#475569' : '#94a3b8',
          strokeDasharray: '5,5',
        }}
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
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-[#FAFBFC] nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
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
