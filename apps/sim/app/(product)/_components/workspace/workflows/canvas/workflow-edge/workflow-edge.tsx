'use client'

import { memo, useCallback, useId, useMemo, useSyncExternalStore } from 'react'
import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  useStore,
} from '@xyflow/react'
import styles from '@/app/(product)/_components/workspace/workflows/canvas/workflow-edge/workflow-edge.module.css'
import {
  isEdgeConnectedToEditor,
  isEdgeHighlighted,
  useIsBlockActive,
  useIsCurrentWorkflowExecuting,
  useLastRunEdges,
  usePanelEditorStore,
  usePanelStore,
  X,
} from '@/platform/lib/data/workflows'

/**
 * Diff state of an edge when comparing two workflow versions. `ghost` is the
 * quiet trace of a connection that no longer exists.
 */
type EdgeDiffStatus = 'new' | 'ghost' | null

/** Execution outcome of an edge for run-path visualization. */
type EdgeRunStatus = 'success' | 'error' | 'not-executed' | undefined

const EXECUTION_PULSE_LENGTH = 0.32
const EXECUTION_PULSE_CYCLE_LENGTH = 2.2
const EXECUTION_PULSE_DURATION = '1100ms'
const DEFAULT_EDGE_LABEL_Z_INDEX = 1011

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

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function getReducedMotionSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/** Server render assumes full motion, matching the CSS default. */
function getReducedMotionServerSnapshot() {
  return false
}

/**
 * Whether the user has asked for reduced motion, as reactive state. Gates the SMIL pulse itself:
 * hiding it with CSS would leave its timelines running.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot
  )
}

interface WorkflowEdgeData extends Record<string, unknown> {
  isSelected?: boolean
  onDelete?: (edgeId: string) => void
}

type WorkflowEdgeType = Edge<WorkflowEdgeData>

/**
 * Props for the pure workflow edge renderer.
 *
 * Geometry and `data` come straight from ReactFlow. The visual state that would
 * otherwise be read from stores — diff status, run status, and whether the run
 * status originated from a preview — is resolved by the container and passed in.
 */
interface WorkflowEdgeViewProps extends EdgeProps<WorkflowEdgeType> {
  /** Version-comparison diff state; the live canvas passes `null`. */
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
 * 1. Diff status (new/ghost) - for version comparison
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
    let color = 'var(--wf-workflow-edge)'
    let opacity = 1

    if (diffStatus === 'ghost') {
      color = 'var(--wf-text-tertiary)'
      opacity = 0.7
    } else if (diffStatus === 'new') {
      color = 'var(--wf-brand-accent)'
    } else if (isWorkflowRunning) {
      if (runStatus === 'error') {
        color = 'var(--wf-text-error)'
      } else if (runStatus === 'success') {
        color = 'var(--wf-text-secondary)'
      } else {
        opacity = 0.52
      }
    } else {
      if (runStatus === 'error' || isErrorEdge) {
        color = 'var(--wf-text-error)'
      } else if (runStatus === 'success') {
        color = isPreviewRun ? 'var(--wf-brand-accent)' : 'var(--wf-border-success)'
      } else if (isConnectedToSelection) {
        color = 'var(--wf-text-secondary)'
      }
    }

    if (isSelected && !isWorkflowRunning) {
      opacity = 0.5
    }

    return {
      strokeWidth: diffStatus === 'ghost' ? 1.5 : diffStatus ? 2.5 : hasRunStatus ? 2 : 1.5,
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
                  stroke='var(--wf-white)'
                  strokeWidth={layer.strokeWidth}
                  strokeLinecap='round'
                  pathLength={1}
                  strokeDasharray={motion.dashArray}
                  vectorEffect='non-scaling-stroke'
                  filter={layer.id === 'tail' ? `url(#${pulseGlowId})` : undefined}
                  opacity={layer.opacity}
                  className={styles.pulseLayer}
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

      {isSelected && data?.onDelete && (
        <EdgeLabelRenderer>
          <button
            aria-label='Delete connection'
            type='button'
            className={`nodrag nopan ${styles.deleteButton}`}
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
            <X className={styles.deleteIcon} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

type WorkflowEdgeProps = EdgeProps<WorkflowEdgeType>

const WorkflowEdgeComponent = (props: WorkflowEdgeProps) => {
  const { id, data, source, target } = props

  const lastRunEdges = useLastRunEdges()
  const isWorkflowRunning = useIsCurrentWorkflowExecuting()
  const isTargetActive = useIsBlockActive(target)
  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const activeTab = usePanelStore((state) => state.activeTab)

  /**
   * Match the block ring: darken edges when an endpoint is canvas-selected or
   * open in the editor panel (same `--text-secondary` as the selection ring).
   */
  const isEndpointSelected = useStore(
    useCallback(
      (state) =>
        Boolean(state.nodeLookup.get(source)?.selected || state.nodeLookup.get(target)?.selected),
      [source, target]
    )
  )
  const isConnectedToSelection = Boolean(
    isEndpointSelected ||
      (data as { isConnectedToSelection?: boolean } | undefined)?.isConnectedToSelection
  )
  const isConnectedToEditor = isEdgeConnectedToEditor(
    activeTab === 'editor' ? currentBlockId : null,
    source,
    target
  )
  const shouldHighlightEdge = isEdgeHighlighted({
    isEndpointSelected: isConnectedToSelection,
    isConnectedToEditor,
  })

  const previewExecutionStatus = (
    data as { executionStatus?: 'success' | 'error' | 'not-executed' } | undefined
  )?.executionStatus
  const runStatus = previewExecutionStatus || lastRunEdges.get(id)

  return (
    <WorkflowEdgeView
      {...props}
      diffStatus={null}
      runStatus={runStatus}
      isPreviewRun={Boolean(previewExecutionStatus)}
      isWorkflowRunning={isWorkflowRunning}
      isTargetActive={isTargetActive}
      isConnectedToSelection={shouldHighlightEdge}
    />
  )
}

/**
 * Editor container for the workflow edge: reads the diff and execution stores, resolves the edge's
 * diff/run state, and renders the legacy edge pixels.
 */
export const WorkflowEdge = memo(WorkflowEdgeComponent)
