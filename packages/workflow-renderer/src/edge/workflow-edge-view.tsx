import { useId, useMemo } from 'react'
import { usePrefersReducedMotion } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
} from '@xyflow/react'
import type { EdgeDiffStatus, EdgeRunStatus } from '../types'
import { ExecutionPulse, PULSE_GLOW_BLEED_PX } from './execution-pulse'

const DEFAULT_EDGE_LABEL_Z_INDEX = 1011

/**
 * Props for the pure workflow edge renderer.
 *
 * Geometry and `data` come straight from ReactFlow. The visual state that would
 * otherwise be read from stores — diff status, run status, and whether the run
 * status originated from a preview — is resolved by the container and passed in.
 */
export interface WorkflowEdgeData extends Record<string, unknown> {
  isSelected?: boolean
  onDelete?: (edgeId: string) => void
}

export type WorkflowEdge = Edge<WorkflowEdgeData>

export interface WorkflowEdgeViewProps extends EdgeProps<WorkflowEdge> {
  /** Pre-resolved diff state (container reads the diff store). */
  diffStatus: EdgeDiffStatus
  /** Pre-resolved execution outcome (container reads the execution store). */
  runStatus: EdgeRunStatus
  /** Whether `runStatus` came from a preview run (drives success coloring). */
  isPreviewRun: boolean
  /** Whether canvas execution is active, which suppresses per-edge success progression. */
  isWorkflowRunning?: boolean
  /** Whether the edge's target block is currently executing. */
  isTargetActive?: boolean
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
 * 2. Live execution path and errors
 * 3. Execution result after the run completes
 * 4. Selected endpoint outside execution
 * 5. Default edge color
 */
export function WorkflowEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  data,
  style,
  diffStatus,
  runStatus,
  isPreviewRun,
  isWorkflowRunning = false,
  isTargetActive = false,
  isConnectedToSelection = false,
}: WorkflowEdgeViewProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const pulseId = useId().replaceAll(':', '')
  const pulseGlowId = `workflow-edge-pulse-glow-${pulseId}`
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

  /*
   * Endpoint bounds grown by the routing offset the path may bend out to, plus
   * the widest pulse stroke and the blur's reach. Computed in user space so a
   * flat path still gets a real region — see the filter below.
   */
  const pulseGlowBounds = useMemo(() => {
    const padding = (isHorizontal ? 30 : 20) + PULSE_GLOW_BLEED_PX
    const x = Math.min(sourceX, targetX) - padding
    const y = Math.min(sourceY, targetY) - padding
    return {
      x,
      y,
      width: Math.abs(targetX - sourceX) + padding * 2,
      height: Math.abs(targetY - sourceY) + padding * 2,
    }
  }, [isHorizontal, sourceX, sourceY, targetX, targetY])

  const isSelected = data?.isSelected ?? false
  const labelZIndex =
    (data as { labelZIndex?: number } | undefined)?.labelZIndex ?? DEFAULT_EDGE_LABEL_Z_INDEX

  const dataSourceHandle = (data as { sourceHandle?: string } | undefined)?.sourceHandle
  const isErrorEdge = (sourceHandleId ?? dataSourceHandle) === 'error'
  const hasRunStatus = runStatus === 'success' || runStatus === 'error'
  const isTraversing = isWorkflowRunning && hasRunStatus && isTargetActive && !diffStatus
  /*
   * Gated on the setting rather than `motion-reduce:hidden`: that compiles to
   * `display: none`, which hides the pulse but leaves four SMIL timelines
   * running per traversing edge. `isTraversing` itself stays semantic so
   * `executionState` still reports the edge as traversing either way.
   */
  const showsPulse = isTraversing && !prefersReducedMotion
  const executionState = isWorkflowRunning
    ? isTraversing
      ? 'traversing'
      : hasRunStatus
        ? 'traversed'
        : 'waiting'
    : hasRunStatus
      ? 'complete'
      : 'idle'

  const edgeStyle = useMemo(() => {
    let color = 'var(--workflow-edge)'
    let opacity = 1

    if (diffStatus === 'deleted') {
      color = 'var(--text-error)'
      opacity = 0.7
    } else if (diffStatus === 'ghost') {
      color = 'var(--text-tertiary)'
      opacity = 0.7
    } else if (diffStatus === 'new') {
      color = 'var(--brand-accent)'
    } else if (isWorkflowRunning) {
      if (runStatus === 'error') {
        color = 'var(--text-error)'
      } else if (runStatus === 'success') {
        color = 'var(--text-secondary)'
      } else {
        opacity = 0.52
      }
    } else {
      if (runStatus === 'error' || isErrorEdge) {
        color = 'var(--text-error)'
      } else if (runStatus === 'success') {
        color = isPreviewRun ? 'var(--brand-accent)' : 'var(--border-success)'
      } else if (isConnectedToSelection) {
        color = 'var(--text-secondary)'
      }
    }

    if (isSelected && !isWorkflowRunning) {
      opacity = 0.5
    }

    return {
      strokeWidth: diffStatus === 'ghost' ? 1.5 : diffStatus ? 2.5 : hasRunStatus ? 2 : 1.5,
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
    hasRunStatus,
    runStatus,
    isPreviewRun,
    isWorkflowRunning,
    isConnectedToSelection,
  ])

  return (
    <>
      <g data-workflow-edge-state={executionState}>
        <BaseEdge path={edgePath} style={edgeStyle} interactionWidth={30} />
        {showsPulse && (
          <ExecutionPulse path={edgePath} glowId={pulseGlowId} glowBounds={pulseGlowBounds} />
        )}
      </g>

      {isSelected && (
        <EdgeLabelRenderer>
          <button
            aria-label='Delete connection'
            type='button'
            className='nodrag nopan group flex size-[22px] cursor-pointer items-center justify-center transition-colors'
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: labelZIndex,
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
