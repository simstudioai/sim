'use client'

import { GooDefs } from '@/app/(landing)/components/mothership/components/iso-marks/goo-defs'
import {
  type Edge,
  edgesToPaths,
  isoProject,
  type MarkState,
  type Pt,
  useGooMark,
  useMarkIds,
} from '@/app/(landing)/components/mothership/components/iso-marks/use-goo-mark'

/**
 * Sim iso goo-mark: ISO STAR.
 * Three cuboid bars crossing at 0 / +60 / -60 degrees forming a 6-point
 * interlocking star. Rest: thin bars, still. Hover (open + spin): bars thicken,
 * spins.
 */
interface StarState extends MarkState {
  thickness: number
  spin: number
}

const REST: StarState = { thickness: 5, spin: 0 }
const HOVER: StarState = { thickness: 13, spin: 1.2 }

const BAR_LENGTH = 16
const STROKE = 1.5
const GOO_FUSION = 0.8

function rotZ(p: [number, number, number], a: number): [number, number, number] {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]
}

function barEdges(L: number, T: number): [number, number, number][][] {
  const C = (sx: number, sy: number, sz: number): [number, number, number] => [
    sx * L,
    sy * T,
    sz * T,
  ]
  const corners: [number, number, number][] = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ]
  const ci = (s: [number, number, number]) => C(s[0], s[1], s[2])
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
  return ed.map(([a, b]) => [ci(corners[a]), ci(corners[b])])
}

function buildEdges(c: StarState): Edge[] {
  const L = BAR_LENGTH * 0.5
  const T = c.thickness * 0.5
  const angs = [c.spin, Math.PI / 3 + c.spin, -Math.PI / 3 + c.spin]
  const E: Edge[] = []
  for (const a of angs) {
    for (const [p, q] of barEdges(L, T)) {
      const pr = rotZ(p, a)
      const qr = rotZ(q, a)
      const A: Pt = isoProject(pr[0], pr[1], 1 + pr[2], 1)
      const B: Pt = isoProject(qr[0], qr[1], 1 + qr[2], 1)
      E.push([A, B])
    }
  }
  return E
}

export interface IsoStarProps {
  size?: number
  className?: string
  forceHover?: boolean
}

export function IsoStar({ size = 110, className, forceHover = false }: IsoStarProps) {
  const { current, bind } = useGooMark<StarState>({ rest: REST, hover: HOVER, forceHover })
  const { gradId, gooId } = useMarkIds()

  return (
    <svg
      viewBox='0 0 100 100'
      width={size}
      height={size}
      role='img'
      aria-label='Iso star'
      className={className}
      style={{ display: 'block', outline: 'none' }}
      {...bind}
    >
      <GooDefs gradId={gradId} gooId={gooId} gooFusion={GOO_FUSION} />
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
