import { useMemo } from 'react'
import { X } from '@sim/emcn/icons'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from 'reactflow'
import type { EdgeDiffStatus, EdgeRunStatus } from '../types'

/**
 * Props for the pure workflow edge renderer.
 *
 * Geometry and `data` come straight from ReactFlow. The visual state that would
 * otherwise be read from stores — diff status, run status, and whether the run
 * status originated from a preview — is resolved by the container and passed in.
 */
export interface WorkflowEdgeViewProps extends EdgeProps {
  sourceHandle?: string | null
  /** Pre-resolved diff state (container reads the diff store). */
  diffStatus: EdgeDiffStatus
  /** Pre-resolved execution outcome (container reads the execution store). */
  runStatus: EdgeRunStatus
  /** Whether `runStatus` came from a preview run (drives success coloring). */
  isPreviewRun: boolean
  /** Whether the canvas is currently presenting an active workflow run. */
  isWorkflowRunning?: boolean
  /**
   * Whether either endpoint block is selected on the canvas — brightens the
   * edge alongside the selected node. Diff and error colors take priority.
   */
  isConnectedToSelection?: boolean
}

/**
 * Pure workflow edge renderer with execution status and diff visualization.
 *
 * @remarks
 * Edge coloring priority:
 * 1. Diff status (deleted/new) - for version comparison
 * 2. Execution error and untaken error paths
 * 3. Active canvas execution
 * 4. Execution success
 * 5. Selected endpoint
 * 6. Default edge color
 */
export function WorkflowEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  sourceHandle,
  diffStatus,
  runStatus,
  isPreviewRun,
  isWorkflowRunning = false,
  isConnectedToSelection = false,
}: WorkflowEdgeViewProps) {
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

  const dataSourceHandle = (data as { sourceHandle?: string } | undefined)?.sourceHandle
  const isErrorEdge = (sourceHandle ?? dataSourceHandle) === 'error'

  const edgeStyle = useMemo(() => {
    let color = 'var(--workflow-edge)'
    let opacity = 1

    if (diffStatus === 'deleted') {
      color = 'var(--text-error)'
      opacity = 0.7
    } else if (diffStatus === 'new') {
      color = 'var(--brand-accent)'
    } else if (runStatus === 'error') {
      color = 'var(--text-error)'
    } else if (isErrorEdge) {
      // Error edges that weren't taken stay red
      color = 'var(--text-error)'
    } else if (isWorkflowRunning) {
      color = 'var(--text-secondary)'
    } else if (runStatus === 'success') {
      color = isPreviewRun ? 'var(--brand-accent)' : 'var(--border-success)'
    } else if (isConnectedToSelection) {
      // Match the selected block ring / swell (`--text-secondary`)
      color = 'var(--text-secondary)'
    }

    if (isSelected) {
      opacity = 0.5
    }

    return {
      strokeWidth: diffStatus ? 2.5 : runStatus === 'success' || runStatus === 'error' ? 2 : 1.5,
      strokeDasharray: diffStatus === 'deleted' ? '10,5' : undefined,
      opacity,
      ...(style ?? {}),
      // Selection/status stroke must win over any default edge style.
      stroke: color,
    }
  }, [
    style,
    diffStatus,
    isSelected,
    isErrorEdge,
    runStatus,
    isPreviewRun,
    isWorkflowRunning,
    isConnectedToSelection,
  ])

  return (
    <>
      <BaseEdge path={edgePath} style={edgeStyle} interactionWidth={30} />

      {isSelected && (
        <EdgeLabelRenderer>
          <button
            type='button'
            className='nodrag nopan group flex size-[22px] cursor-pointer items-center justify-center transition-colors'
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 1011,
            }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()

              if (data?.onDelete) {
                data.onDelete(id)
              }
            }}
          >
            <X className='size-4 text-[var(--text-error)] transition-colors group-hover:text-[color-mix(in_srgb,var(--text-error)_80%,transparent)]' />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
