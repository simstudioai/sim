import { useId, useMemo } from 'react'
import { usePrefersReducedMotion } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from 'reactflow'
import type { EdgeDiffStatus, EdgeRunStatus } from '../types'

const EXECUTION_PULSE_LENGTH = 0.32
const EXECUTION_PULSE_CYCLE_LENGTH = 2.2
const EXECUTION_PULSE_DURATION = '1100ms'

/**
 * How far the glow reaches past the path, in user space.
 *
 * The pulse strokes are `non-scaling-stroke`, so the widest one (6px) covers
 * `3 / zoom` user units — 30 at the canvas minimum of 0.1 — while the blur adds
 * roughly 3σ more. Under-sizing the filter region does not shrink the glow, it
 * clips it to a hard rectangle, so this is rounded up rather than tuned: the
 * region only bounds the output, it costs nothing to be larger than needed.
 */
const PULSE_GLOW_BLEED_PX = 40

const EXECUTION_PULSE_LAYERS = [
  { id: 'tail', length: EXECUTION_PULSE_LENGTH, opacity: 0.22, strokeWidth: 6 },
  { id: 'shoulder', length: 0.23, opacity: 0.32, strokeWidth: 3.5 },
  { id: 'body', length: 0.15, opacity: 0.6, strokeWidth: 2.5 },
  { id: 'core', length: 0.07, opacity: 1, strokeWidth: 2.5 },
] as const

function getExecutionPulseMotion(length: number) {
  const centerOffset = (EXECUTION_PULSE_LENGTH - length) / 2

  return {
    dashArray: `${length} ${(EXECUTION_PULSE_CYCLE_LENGTH - length).toFixed(2)}`,
    from: centerOffset === 0 ? '0' : `-${centerOffset.toFixed(3)}`,
    to: `-${(EXECUTION_PULSE_CYCLE_LENGTH + centerOffset).toFixed(3)}`,
  }
}

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
  data,
  style,
  sourceHandle,
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

  const dataSourceHandle = (data as { sourceHandle?: string } | undefined)?.sourceHandle
  const isErrorEdge = (sourceHandle ?? dataSourceHandle) === 'error'
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
      strokeWidth: diffStatus ? 2.5 : hasRunStatus ? 2 : 1.5,
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
          <>
            <defs>
              {/*
                `userSpaceOnUse` rather than the default `objectBoundingBox`: a
                straight horizontal edge — what an auto-laid-out chain produces,
                since handles sit at fixed Y offsets — has a zero-height
                bounding box, which resolves the region to zero height and stops
                the referencing element from rendering at all.
              */}
              <filter
                id={pulseGlowId}
                filterUnits='userSpaceOnUse'
                x={pulseGlowBounds.x}
                y={pulseGlowBounds.y}
                width={pulseGlowBounds.width}
                height={pulseGlowBounds.height}
              >
                <feGaussianBlur stdDeviation='2.4' />
              </filter>
            </defs>
            {EXECUTION_PULSE_LAYERS.map((layer) => {
              const motion = getExecutionPulseMotion(layer.length)

              return (
                <path
                  key={layer.id}
                  data-workflow-edge-pulse-layer={layer.id}
                  data-workflow-edge-pulse-glow={layer.id === 'tail' ? '' : undefined}
                  data-workflow-edge-traversing={layer.id === 'core' ? '' : undefined}
                  d={edgePath}
                  fill='none'
                  stroke='var(--white)'
                  strokeWidth={layer.strokeWidth}
                  strokeLinecap='round'
                  pathLength={1}
                  strokeDasharray={motion.dashArray}
                  vectorEffect='non-scaling-stroke'
                  filter={layer.id === 'tail' ? `url(#${pulseGlowId})` : undefined}
                  opacity={layer.opacity}
                  className='pointer-events-none'
                >
                  <animate
                    attributeName='stroke-dashoffset'
                    from={motion.from}
                    to={motion.to}
                    dur={EXECUTION_PULSE_DURATION}
                    calcMode='linear'
                    repeatCount='indefinite'
                  />
                </path>
              )
            })}
          </>
        )}
      </g>

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
