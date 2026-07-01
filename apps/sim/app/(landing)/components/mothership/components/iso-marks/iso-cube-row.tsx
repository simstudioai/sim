'use client'

import { cn } from '@sim/emcn'
import { GooDefs } from '@/app/(landing)/components/mothership/components/iso-marks/goo-defs'
import {
  type Edge,
  gradientForTone,
  isoProject,
  type MarkState,
  type Pt,
  TARGET,
  useGooMark,
  useMarkIds,
} from '@/app/(landing)/components/mothership/components/iso-marks/use-goo-mark'

/**
 * Sim iso goo-mark: CUBE ROW.
 * Three cubes set in a level row. Rest: an even row, all one size. Hover (read):
 * each cube resizes to a different scale, like a live gauge re-leveling. No
 * spin; the motion is pure isometric scale.
 */
interface RowState extends MarkState {
  s0: number
  s1: number
  s2: number
  tilt: number
  tone: number
}

const REST: RowState = { s0: 0.62, s1: 0.62, s2: 0.62, tilt: 0.5, tone: 1 }
const HOVER: RowState = { s0: 0.95, s1: 0.55, s2: 0.8, tilt: 0.5, tone: 1 }

const SLOTS = 3
const SPREAD = 0.92
const STROKE = 2.4
const GOO_FUSION = 1.0

function cubeAt(cx: number, cy: number, half: number, ky: number): Edge[] {
  const corner = (sx: number, sy: number, sz: number) =>
    isoProject(cx + sx * half, cy + sy * half, sz * half, ky)
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

function buildEdges(s: RowState): Edge[] {
  const sizes = [s.s0, s.s1, s.s2]
  const edges: Edge[] = []
  for (let i = 0; i < SLOTS; i++) {
    const t = (i - (SLOTS - 1) / 2) * SPREAD
    edges.push(...cubeAt(t, -t, sizes[i], s.tilt))
  }
  return edges
}

function normalizeEdges(edges: Edge[]): Edge[] {
  const pts = edges.flat()
  let minx = Number.POSITIVE_INFINITY
  let maxx = Number.NEGATIVE_INFINITY
  let miny = Number.POSITIVE_INFINITY
  let maxy = Number.NEGATIVE_INFINITY
  for (const [x, y] of pts) {
    if (x < minx) minx = x
    if (x > maxx) maxx = x
    if (y < miny) miny = y
    if (y > maxy) maxy = y
  }
  const w = maxx - minx || 1
  const h = maxy - miny || 1
  const scale = TARGET / Math.max(w, h)
  const ox = 50 - ((minx + maxx) / 2) * scale
  const oy = 50 - ((miny + maxy) / 2) * scale
  const tx = (p: Pt): Pt => [ox + p[0] * scale, oy + p[1] * scale]
  return edges.map(([A, B]) => [tx(A), tx(B)] as Edge)
}

function edgesToD(edges: Edge[]): string {
  let d = ''
  for (const [A, B] of edges) {
    d += `M${A[0].toFixed(2)} ${A[1].toFixed(2)} L${B[0].toFixed(2)} ${B[1].toFixed(2)} `
  }
  return d.trim()
}

export interface IsoCubeRowProps {
  size?: number
  className?: string
  forceHover?: boolean
}

export function IsoCubeRow({ size = 110, className, forceHover = false }: IsoCubeRowProps) {
  const { current, bind } = useGooMark<RowState>({ rest: REST, hover: HOVER, forceHover })
  const { gradId, gooId } = useMarkIds()

  const edges = normalizeEdges(buildEdges(current))
  const { from, to } = gradientForTone(current.tone)

  return (
    <svg
      viewBox='0 0 100 100'
      width={size}
      height={size}
      role='img'
      aria-label='Cube row'
      className={cn(
        'focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-[var(--brand-agent)]',
        className
      )}
      style={{ display: 'block' }}
      {...bind}
    >
      <GooDefs gradId={gradId} gooId={gooId} gooFusion={GOO_FUSION} from={from} to={to} />
      <g
        filter={`url(#${gooId})`}
        strokeWidth={STROKE}
        strokeLinecap='round'
        strokeLinejoin='round'
        fill='none'
      >
        <path d={edgesToD(edges)} stroke={`url(#${gradId})`} />
      </g>
    </svg>
  )
}
