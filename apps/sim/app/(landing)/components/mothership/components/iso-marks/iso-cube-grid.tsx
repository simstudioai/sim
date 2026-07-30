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
 * Sim iso goo-mark: CUBE GRID.
 * Nine small iso cubes tiled in a 3×3 screen grid. Rest: the nine sit spread
 * apart. Hover (gather): they pull in toward the center into a snug grid - still
 * clearly nine separate cubes, never merged into a blob. No spin; the motion is
 * pure convergence.
 */
interface GridState extends MarkState {
  gap: number
  tilt: number
  tone: number
}

const REST: GridState = { gap: 3.3, tilt: 0.5, tone: 1 }
const HOVER: GridState = { gap: 2.05, tilt: 0.5, tone: 1 }

const GRID = 3
const U = 0.5
const STROKE = 2.4
const GOO_FUSION = 0.55

/** A unit iso cube, projected to screen space and centered on the origin. */
function unitCubeEdges(ky: number): Edge[] {
  const corner = (sx: number, sy: number, sz: number) => isoProject(sx * U, sy * U, sz * U, ky)
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

function buildEdges(s: GridState): Edge[] {
  const base = unitCubeEdges(s.tilt)
  const edges: Edge[] = []
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const dx = (i - (GRID - 1) / 2) * s.gap
      const dy = (j - (GRID - 1) / 2) * s.gap
      for (const [A, B] of base) {
        edges.push([
          [A[0] + dx, A[1] + dy],
          [B[0] + dx, B[1] + dy],
        ])
      }
    }
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

export interface IsoCubeGridProps {
  size?: number
  className?: string
  forceHover?: boolean
}

export function IsoCubeGrid({ size = 110, className, forceHover = false }: IsoCubeGridProps) {
  const { current, bind } = useGooMark<GridState>({ rest: REST, hover: HOVER, forceHover })
  const { gradId, gooId } = useMarkIds()

  const edges = normalizeEdges(buildEdges(current))
  const { from, to } = gradientForTone(current.tone)

  return (
    <svg
      viewBox='0 0 100 100'
      width={size}
      height={size}
      role='img'
      aria-label='Cube grid'
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
