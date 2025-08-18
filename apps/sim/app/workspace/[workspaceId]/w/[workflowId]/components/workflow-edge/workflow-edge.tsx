import { useEffect } from 'react'
import { X } from 'lucide-react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from 'reactflow'
import type { EdgeDiffStatus } from '@/lib/workflows/diff/types'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'
import { useCurrentWorkflow } from '../../hooks'

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

  // Use the directly provided isSelected flag instead of computing it
  const isSelected = data?.isSelected ?? false
  const isInsideLoop = data?.isInsideLoop ?? false
  const parentLoopId = data?.parentLoopId

  // Get edge diff status
  const diffAnalysis = useWorkflowDiffStore((state) => state.diffAnalysis)
  const isShowingDiff = useWorkflowDiffStore((state) => state.isShowingDiff)
  const isDiffReady = useWorkflowDiffStore((state) => state.isDiffReady)
  const currentWorkflow = useCurrentWorkflow()

  // Generate edge identifier using block IDs to match diff analysis from sim agent
  // This must exactly match the logic used by the sim agent diff analysis
  const generateEdgeIdentity = (
    sourceId: string,
    targetId: string,
    sourceHandle?: string | null,
    targetHandle?: string | null
  ): string => {
    // The sim agent generates edge identifiers in the format: sourceId-source-targetId-target
    return `${sourceId}-source-${targetId}-target`
  }

  // Generate edge identifier using the exact same logic as the sim agent
  const edgeIdentifier = generateEdgeIdentity(source, target, sourceHandle, targetHandle)

  // Debug logging to understand what's happening
  useEffect(() => {
    if (edgeIdentifier && diffAnalysis?.edge_diff) {
      console.log(`[Edge Debug] Edge ${id}:`, {
        edgeIdentifier,
        sourceHandle,
        targetHandle,
        sourceBlockId: source,
        targetBlockId: target,
        isShowingDiff,
        isDiffMode: currentWorkflow.isDiffMode,
        edgeDiffAnalysis: diffAnalysis.edge_diff,
        // Show actual array contents to see why matching fails
        newEdgesArray: diffAnalysis.edge_diff.new_edges,
        deletedEdgesArray: diffAnalysis.edge_diff.deleted_edges,
        unchangedEdgesArray: diffAnalysis.edge_diff.unchanged_edges,
        // Check if this edge matches any in the diff analysis
        matchesNew: diffAnalysis.edge_diff.new_edges.includes(edgeIdentifier),
        matchesDeleted: diffAnalysis.edge_diff.deleted_edges.includes(edgeIdentifier),
        matchesUnchanged: diffAnalysis.edge_diff.unchanged_edges.includes(edgeIdentifier),
      })
    }
  }, [
    edgeIdentifier,
    diffAnalysis,
    isShowingDiff,
    id,
    sourceHandle,
    targetHandle,
    source,
    target,
    currentWorkflow.isDiffMode,
  ])

  // One-time debug log of full diff analysis
  useEffect(() => {
    if (diffAnalysis && id === Object.keys(currentWorkflow.blocks)[0]) {
      // Only log once per diff
      console.log('[Full Diff Analysis]:', {
        edge_diff: diffAnalysis.edge_diff,
        new_blocks: diffAnalysis.new_blocks,
        edited_blocks: diffAnalysis.edited_blocks,
        deleted_blocks: diffAnalysis.deleted_blocks,
        isShowingDiff,
        currentWorkflowEdgeCount: currentWorkflow.edges.length,
        currentWorkflowBlockCount: Object.keys(currentWorkflow.blocks).length,
      })
    }
  }, [diffAnalysis, id, currentWorkflow.blocks, currentWorkflow.edges, isShowingDiff])

  // Determine edge diff status
  let edgeDiffStatus: EdgeDiffStatus = null

  // Only attempt to determine diff status if all required data is available
  if (diffAnalysis?.edge_diff && edgeIdentifier && isDiffReady) {
    if (isShowingDiff) {
      // In diff view, show new edges
      if (diffAnalysis.edge_diff.new_edges.includes(edgeIdentifier)) {
        edgeDiffStatus = 'new'
      } else if (diffAnalysis.edge_diff.unchanged_edges.includes(edgeIdentifier)) {
        edgeDiffStatus = 'unchanged'
      }
    } else {
      // In original workflow, show deleted edges
      if (diffAnalysis.edge_diff.deleted_edges.includes(edgeIdentifier)) {
        edgeDiffStatus = 'deleted'
      }
    }
  }

  // Merge any style props passed from parent with diff highlighting
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
