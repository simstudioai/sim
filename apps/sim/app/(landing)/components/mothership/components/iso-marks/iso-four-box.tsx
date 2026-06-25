'use client'

import { cn } from '@/lib/core/utils/cn'
import { GooDefs } from '@/app/(landing)/components/mothership/components/iso-marks/goo-defs'
import {
  type Edge,
  gradientForTone,
  isoProject,
  type MarkState,
  type Pt,
  rotate2,
  TARGET,
  useGooMark,
  useMarkIds,
} from '@/app/(landing)/components/mothership/components/iso-marks/use-goo-mark'

/**
 * Sim iso goo-mark: FOUR-BOX TWIST.
 * Four wireframe boxes layered vertically, each rotated at a progressive angular
 * offset so the stack twists into a rounded cluster. Rest: open and twisted,
 * still. Hover (close + spin): gap collapses, twist unwinds, spins. An optional
 * signal-blue accent box is off by default (the landing stays greyscale).
 */
interface FourBoxState extends MarkState {
  gap: number
  twist: number
  spin: number
  tilt: number
  tone: number
}

const REST: FourBoxState = { gap: 1, twist: 11, spin: -0.38, tilt: 0.4, tone: 1 }
const HOVER: FourBoxState = { gap: 0, twist: 0, spin: -3.14, tilt: 0.4, tone: 1 }

const BOXES = 2
const STROKE = 2.4
const GOO_FUSION = 1.4
const BLUE = '#9FC6E8'

function boxEdges(s: number, ky: number, rot: number, zc: number): Edge[] {
  const corner = (sx: number, sy: number, sz: number) => {
    const [rx, ry] = rotate2(sx * s, sy * s, rot)
    return isoProject(rx, ry, sz * s * 0.4 + zc, ky)
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

function buildBoxes(c: FourBoxState): Edge[][] {
  const twRad = (c.twist * Math.PI) / 180
  const totalH = (BOXES - 1) * c.gap
  const boxes: Edge[][] = []
  for (let i = 0; i < BOXES; i++) {
    const zc = i * c.gap - totalH / 2
    const rot = c.spin * i * 0.5 + i * twRad
    boxes.push(boxEdges(1.0, c.tilt, rot, zc))
  }
  return boxes
}

function normalizeBoxes(boxes: Edge[][]): Edge[][] {
  const pts = boxes.flat().flat()
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
  return boxes.map((bx) => bx.map(([A, B]) => [tx(A), tx(B)] as Edge))
}

function edgesToD(edges: Edge[]): string {
  let d = ''
  for (const [A, B] of edges) {
    d += `M${A[0].toFixed(2)} ${A[1].toFixed(2)} L${B[0].toFixed(2)} ${B[1].toFixed(2)} `
  }
  return d.trim()
}

export interface IsoFourBoxProps {
  size?: number
  className?: string
  forceHover?: boolean
  /** Render one box (the 2nd from bottom) in the signal-blue accent. */
  blueAccent?: boolean
}

export function IsoFourBox({
  size = 110,
  className,
  forceHover = false,
  blueAccent = false,
}: IsoFourBoxProps) {
  const { current, bind } = useGooMark<FourBoxState>({ rest: REST, hover: HOVER, forceHover })
  const { gradId, gooId } = useMarkIds()

  const boxes = normalizeBoxes(buildBoxes(current))
  const { from, to } = gradientForTone(current.tone)
  const blueIdx = blueAccent ? 1 : -1
  const normal: Edge[] = []
  let blue: Edge[] = []
  boxes.forEach((bx, i) => {
    if (i === blueIdx) blue = bx
    else normal.push(...bx)
  })

  return (
    <svg
      viewBox='0 0 100 100'
      width={size}
      height={size}
      aria-hidden='true'
      className={cn('block outline-none', className)}
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
        <path d={edgesToD(normal)} stroke={`url(#${gradId})`} />
        {blue.length > 0 && <path d={edgesToD(blue)} stroke={BLUE} />}
      </g>
    </svg>
  )
}
