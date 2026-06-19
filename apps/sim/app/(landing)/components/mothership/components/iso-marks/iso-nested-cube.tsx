'use client'

import { GooDefs } from '@/app/(landing)/components/mothership/components/iso-marks/goo-defs'
import {
  type Edge,
  edgesToPaths,
  gradientForTone,
  isoProject,
  type MarkState,
  rotate2,
  useGooMark,
  useMarkIds,
} from '@/app/(landing)/components/mothership/components/iso-marks/use-goo-mark'

/**
 * Sim iso goo-mark: NESTED CUBE.
 * An outer iso cube with a smaller inner cube floating at its center.
 * Rest: small inner cube, still. Hover (open + spin): inner cube grows to fill
 * the shell while spinning.
 */
interface CubeState extends MarkState {
  tilt: number
  inner: number
  spin: number
  tone: number
}

const REST: CubeState = { tilt: 0.24, inner: 0.22, spin: -3.14, tone: 0 }
const HOVER: CubeState = { tilt: 0.3, inner: 0.35, spin: -0.34, tone: 1 }

const STROKE = 2.8
const GOO_FUSION = 1.4

function cubeEdges(s: number, ky: number, rot: number): Edge[] {
  const corner = (sx: number, sy: number, sz: number) => {
    const [rx, ry] = rotate2(sx * s, sy * s, rot)
    return isoProject(rx, ry, sz * s, ky)
  }
  const c = [
    corner(-1, -1, -1),
    corner(1, -1, -1),
    corner(1, 1, -1),
    corner(-1, 1, -1),
    corner(-1, -1, 1),
    corner(1, -1, 1),
    corner(1, 1, 1),
    corner(-1, 1, 1),
  ]
  const ed: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ]
  return ed.map(([a, b]) => [c[a], c[b]] as Edge)
}

function buildEdges(c: CubeState): Edge[] {
  return [...cubeEdges(1.0, c.tilt, 0), ...cubeEdges(c.inner, c.tilt, c.spin)]
}

export interface IsoNestedCubeProps {
  size?: number
  className?: string
  forceHover?: boolean
}

export function IsoNestedCube({ size = 110, className, forceHover = false }: IsoNestedCubeProps) {
  const { current, bind } = useGooMark<CubeState>({ rest: REST, hover: HOVER, forceHover })
  const { gradId, gooId } = useMarkIds()
  const { from, to } = gradientForTone(current.tone)

  return (
    <svg
      viewBox='0 0 100 100'
      width={size}
      height={size}
      role='img'
      aria-label='Nested cube'
      tabIndex={0}
      className={className}
      style={{ display: 'block', outline: 'none' }}
      {...bind}
    >
      <GooDefs gradId={gradId} gooId={gooId} gooFusion={GOO_FUSION} from={from} to={to} />
      <g
        filter={`url(#${gooId})`}
        stroke={`url(#${gradId})`}
        strokeWidth={STROKE}
        strokeLinecap='round'
        strokeLinejoin='round'
        fill='none'
      >
        <path d={edgesToPaths(buildEdges(current))} />
      </g>
    </svg>
  )
}
