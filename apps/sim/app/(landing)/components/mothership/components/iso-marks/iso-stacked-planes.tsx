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
 * Sim iso goo-mark: STACKED PLANES.
 * N lattice sheets layered with a vertical gap.
 * Rest: open and spread, slightly tilted, still. Hover (close + spin): gap
 * collapses tight, tilt steepens, spins.
 */
interface StackState extends MarkState {
  gap: number
  tilt: number
  spin: number
  stroke: number
  gradCx: number
  gradCy: number
  gradR: number
  tone: number
}

const REST: StackState = {
  gap: 34.5,
  tilt: 0.34,
  spin: -2.82,
  stroke: 2,
  gradCx: 50,
  gradCy: 50,
  gradR: 44,
  tone: 1,
}
const HOVER: StackState = {
  gap: 11.5,
  tilt: 0.33,
  spin: -3.14,
  stroke: 2,
  gradCx: 50,
  gradCy: 50,
  gradR: 44,
  tone: 1,
}

const PLANES = 4
const DIVISIONS = 2
const GOO_FUSION = 1.1

function buildEdges(c: StackState): Edge[] {
  const half = 40
  const totalH = (PLANES - 1) * c.gap
  const proj = (u: number, v: number, z: number) => {
    const [ru, rv] = rotate2(u, v, c.spin)
    const p = isoProject(ru * half, rv * half, 0, c.tilt)
    return [p[0], p[1] + (z - totalH / 2)] as [number, number]
  }
  const E: Edge[] = []
  for (let pl = 0; pl < PLANES; pl++) {
    const z = pl * c.gap
    for (let i = 0; i <= DIVISIONS; i++) {
      const v = -1 + (2 * i) / DIVISIONS
      E.push([proj(-1, v, z), proj(1, v, z)])
    }
    for (let i = 0; i <= DIVISIONS; i++) {
      const u = -1 + (2 * i) / DIVISIONS
      E.push([proj(u, -1, z), proj(u, 1, z)])
    }
  }
  return E
}

export interface IsoStackedPlanesProps {
  size?: number
  className?: string
  forceHover?: boolean
}

export function IsoStackedPlanes({
  size = 110,
  className,
  forceHover = false,
}: IsoStackedPlanesProps) {
  const { current, bind } = useGooMark<StackState>({ rest: REST, hover: HOVER, forceHover })
  const { gradId, gooId } = useMarkIds()
  const { from, to } = gradientForTone(current.tone)

  return (
    <svg
      viewBox='0 0 100 100'
      width={size}
      height={size}
      role='img'
      aria-label='Stacked planes'
      className={className}
      style={{ display: 'block', outline: 'none' }}
      {...bind}
    >
      <GooDefs
        gradId={gradId}
        gooId={gooId}
        gooFusion={GOO_FUSION}
        from={from}
        to={to}
        cx={current.gradCx}
        cy={current.gradCy}
        r={current.gradR}
      />
      <g
        filter={`url(#${gooId})`}
        stroke={`url(#${gradId})`}
        strokeWidth={current.stroke}
        strokeLinecap='round'
        strokeLinejoin='round'
        fill='none'
      >
        <path d={edgesToPaths(buildEdges(current))} />
      </g>
    </svg>
  )
}
