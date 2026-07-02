import type { SVGProps } from 'react'

/**
 * Isometric line-art icons for the lifecycle axes - Build, Deploy, Monitor.
 *
 * Each icon is built from one primitive: an {@link IsoBox} described in screen
 * space (a top rhombus of half-width `w` extruded down by height `h`). Because a
 * box is centered on `cx` by construction, symmetric arrangements are trivial,
 * and every visible face is filled with `var(--bg)` so a nearer box cleanly
 * occludes the edges of one behind it - the wireframe technique that keeps the
 * forms readable without shading. Draw boxes far → near.
 *
 * All three share the 132×120 viewBox and inherit color from `currentColor`, so
 * the section sets one tone (`--text-muted`) and the strokes follow. Purely
 * decorative - the parent marks each `aria-hidden`.
 */

const VIEW = { w: 132, h: 120 } as const

interface IsoBoxSpec {
  /** Horizontal center of the box (screen px). */
  cx: number
  /** Vertical center of the top rhombus (screen px). */
  topY: number
  /** Half-width of the top rhombus; its half-height is `w / 2` (isometric). */
  w: number
  /** Vertical extrusion height. */
  h: number
}

/** The three visible faces of an isometric box as SVG path `d` strings. */
function isoFaces({ cx, topY, w, h }: IsoBoxSpec) {
  const rh = w / 2
  const back = `${cx},${topY - rh}`
  const right = `${cx + w},${topY}`
  const front = `${cx},${topY + rh}`
  const left = `${cx - w},${topY}`
  const leftB = `${cx - w},${topY + h}`
  const frontB = `${cx},${topY + rh + h}`
  const rightB = `${cx + w},${topY + h}`
  return {
    top: `M${back} L${right} L${front} L${left} Z`,
    left: `M${left} L${front} L${frontB} L${leftB} Z`,
    right: `M${right} L${front} L${frontB} L${rightB} Z`,
  }
}

function IsoBox(spec: IsoBoxSpec) {
  const { top, left, right } = isoFaces(spec)
  return (
    <>
      <path d={left} />
      <path d={right} />
      <path d={top} />
    </>
  )
}

type IconProps = SVGProps<SVGSVGElement>

function IconFrame({ children, ...props }: IconProps) {
  return (
    <svg
      width={VIEW.w}
      height={VIEW.h}
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      fill='none'
      aria-hidden='true'
      {...props}
    >
      <g
        fill='var(--bg)'
        stroke='currentColor'
        strokeWidth={1.2}
        strokeLinejoin='round'
        strokeLinecap='round'
      >
        {children}
      </g>
    </svg>
  )
}

/** Build - a block descending onto a stack of layers, as if assembling an agent. */
export function BuildIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <IsoBox cx={66} topY={78} w={24} h={7} />
      <IsoBox cx={66} topY={67} w={24} h={7} />
      <IsoBox cx={66} topY={56} w={24} h={7} />
      <IsoBox cx={66} topY={36} w={24} h={7} />
      <path d='M66,31 L75,36 L66,41 L57,36 Z' fill='none' opacity={0.6} />
    </IconFrame>
  )
}

/** Deploy - instances shipping out: a tall unit flanked by two smaller cubes. */
export function DeployIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <IsoBox cx={66} topY={46} w={18} h={28} />
      <IsoBox cx={44} topY={64} w={14} h={18} />
      <IsoBox cx={88} topY={64} w={14} h={18} />
      <circle cx={66} cy={42} r={1.3} fill='currentColor' stroke='none' />
      <circle cx={44} cy={61} r={1.3} fill='currentColor' stroke='none' />
      <circle cx={88} cy={61} r={1.3} fill='currentColor' stroke='none' />
    </IconFrame>
  )
}

const MONITOR_BARS = [
  { x: 44, ground: 86, h: 18 },
  { x: 55, ground: 80.5, h: 30 },
  { x: 66, ground: 75, h: 22 },
  { x: 77, ground: 69.5, h: 38 },
  { x: 88, ground: 64, h: 28 },
] as const

/** Monitor - a run of metric bars receding into the distance, like a live chart. */
export function MonitorIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      {/* Far → near so nearer bars occlude the ones behind them. */}
      {[...MONITOR_BARS].reverse().map((bar) => (
        <IsoBox key={bar.x} cx={bar.x} topY={bar.ground - bar.h} w={5} h={bar.h} />
      ))}
    </IconFrame>
  )
}
