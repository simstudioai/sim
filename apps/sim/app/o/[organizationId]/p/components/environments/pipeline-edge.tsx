'use client'

import { useId } from 'react'
import { usePrefersReducedMotion } from '@sim/emcn'
import { ExecutionPulse } from '@sim/workflow-renderer'

/** The edge's drawing box; the pulse and arrowhead are sized to it, the layout stretches around it. */
const EDGE_WIDTH = 140
const EDGE_HEIGHT = 16
const EDGE_Y = EDGE_HEIGHT / 2
/** Leaves room at the receiving end for the arrowhead, which the marker draws past the path's end. */
const EDGE_INSET = 6

interface PipelineEdgeProps {
  /** `forward` flows left to right (a promotion), `backward` right to left (a refresh). */
  direction: 'forward' | 'backward'
  /** Read aloud in place of the picture. */
  label: string
  animated: boolean
}

/**
 * The line between two environments, drawn like a workflow edge while it runs: one path with its
 * arrowhead as a marker, so the head always sits on the line's receiving end, and the canvas's
 * execution pulse travelling along it in the direction changes flow.
 */
export function PipelineEdge({ direction, label, animated }: PipelineEdgeProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const id = useId().replaceAll(':', '')
  const markerId = `pipeline-edge-head-${id}`
  const start = EDGE_INSET
  const end = EDGE_WIDTH - EDGE_INSET * 2
  const path =
    direction === 'forward'
      ? `M${start} ${EDGE_Y} H${end}`
      : `M${EDGE_WIDTH - start} ${EDGE_Y} H${EDGE_INSET * 2}`
  return (
    <svg
      width={EDGE_WIDTH}
      height={EDGE_HEIGHT}
      viewBox={`0 0 ${EDGE_WIDTH} ${EDGE_HEIGHT}`}
      role='img'
      aria-label={label}
      className='shrink-0 overflow-visible'
    >
      <defs>
        {/* `auto` points the head along the path, so reversing the path turns it around too. */}
        <marker
          id={markerId}
          viewBox='0 0 8 8'
          refX='4'
          refY='4'
          markerWidth='8'
          markerHeight='8'
          markerUnits='userSpaceOnUse'
          orient='auto'
        >
          <path
            d='M1 1 L5 4 L1 7'
            fill='none'
            stroke='var(--text-secondary)'
            strokeWidth='1.75'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </marker>
      </defs>
      <path
        d={path}
        fill='none'
        stroke='var(--text-secondary)'
        strokeWidth={2}
        strokeLinecap='round'
        markerEnd={`url(#${markerId})`}
      />
      {animated && !prefersReducedMotion ? (
        <ExecutionPulse
          path={path}
          glowId={`pipeline-edge-glow-${id}`}
          glowBounds={{ x: -40, y: -40, width: EDGE_WIDTH + 80, height: EDGE_HEIGHT + 80 }}
        />
      ) : null}
    </svg>
  )
}
