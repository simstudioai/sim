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
export const PULSE_GLOW_BLEED_PX = 40

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

/** A user-space rectangle the glow filter may paint in. */
export interface PulseGlowBounds {
  x: number
  y: number
  width: number
  height: number
}

interface ExecutionPulseProps {
  /** The SVG path the pulse travels, start to end. */
  path: string
  /** A document-unique id for the glow filter. */
  glowId: string
  glowBounds: PulseGlowBounds
  /** The pulse's color; the canvas draws it white over the darkened edge. */
  color?: string
}

/**
 * The pulse a running workflow sends along an edge: four stacked strokes, a blurred wide tail
 * up to a bright core, sliding from the path's start to its end. Shared by the canvas edge and
 * anything else that shows work flowing from one place to another.
 */
export function ExecutionPulse({
  path,
  glowId,
  glowBounds,
  color = 'var(--white)',
}: ExecutionPulseProps) {
  return (
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
          id={glowId}
          filterUnits='userSpaceOnUse'
          x={glowBounds.x}
          y={glowBounds.y}
          width={glowBounds.width}
          height={glowBounds.height}
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
            d={path}
            fill='none'
            stroke={color}
            strokeWidth={layer.strokeWidth}
            strokeLinecap='round'
            pathLength={1}
            strokeDasharray={motion.dashArray}
            vectorEffect='non-scaling-stroke'
            filter={layer.id === 'tail' ? `url(#${glowId})` : undefined}
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
  )
}
