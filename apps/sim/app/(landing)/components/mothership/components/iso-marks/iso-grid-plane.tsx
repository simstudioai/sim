'use client'

import { cn } from '@sim/emcn'
import { GooDefs } from '@/app/(landing)/components/mothership/components/iso-marks/goo-defs'
import {
  type Edge,
  edgesToPaths,
  isoProject,
  type MarkState,
  rotate2,
  useGooMark,
  useMarkIds,
} from '@/app/(landing)/components/mothership/components/iso-marks/use-goo-mark'

/**
 * Sim iso goo-mark: GRID PLANE.
 * A single flat lattice rotated 45deg and squashed into isometric.
 * Rest: tilted, still. Hover (open + spin): tilt flattens, spins.
 */
interface GridState extends MarkState {
  tilt: number
  spin: number
}

const REST: GridState = { tilt: 0.5, spin: 0 }
const HOVER: GridState = { tilt: 0.42, spin: 1.2 }

const DIVISIONS = 4
const STROKE = 1.5
const GOO_FUSION = 0.8

function buildEdges(c: GridState): Edge[] {
  const half = 40
  const proj = (u: number, v: number) => {
    const [ru, rv] = rotate2(u, v, c.spin)
    return isoProject(ru * half, rv * half, 0, c.tilt)
  }
  const E: Edge[] = []
  for (let i = 0; i <= DIVISIONS; i++) {
    const v = -1 + (2 * i) / DIVISIONS
    E.push([proj(-1, v), proj(1, v)])
  }
  for (let i = 0; i <= DIVISIONS; i++) {
    const u = -1 + (2 * i) / DIVISIONS
    E.push([proj(u, -1), proj(u, 1)])
  }
  return E
}

export interface IsoGridPlaneProps {
  size?: number
  className?: string
  forceHover?: boolean
}

export function IsoGridPlane({ size = 110, className, forceHover = false }: IsoGridPlaneProps) {
  const { current, bind } = useGooMark<GridState>({ rest: REST, hover: HOVER, forceHover })
  const { gradId, gooId } = useMarkIds()

  return (
    <svg
      viewBox='0 0 100 100'
      width={size}
      height={size}
      aria-hidden='true'
      className={cn('block outline-none', className)}
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
