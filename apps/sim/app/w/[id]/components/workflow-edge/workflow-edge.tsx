import { X } from 'lucide-react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from 'reactflow'

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
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
    offset: 10,
  })

  // Use the directly provided isSelected flag instead of computing it
  const isSelected = data?.isSelected ?? false
  const isInsideLoop = data?.isInsideLoop ?? false
  const parentLoopId = data?.parentLoopId

  // Merge any style props passed from parent
  const edgeStyle = {
    strokeWidth: isSelected ? 2.5 : 2,
    stroke: isSelected ? '#475569' : '#94a3b8',
    strokeDasharray: '5,5',
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
      <animate
        attributeName='stroke-dashoffset'
        from='10'
        to='0'
        dur='1s'
        repeatCount='indefinite'
      />

      {isSelected && (
        <EdgeLabelRenderer>
          <div
            className='nodrag nopan flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-[#FAFBFC] shadow-sm'
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 22,
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
