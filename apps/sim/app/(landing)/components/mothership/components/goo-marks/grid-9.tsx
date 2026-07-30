'use client'

import type { ReactNode } from 'react'
import { GooMarkSvg } from '@/app/(landing)/components/mothership/components/goo-marks/goo-mark-svg'
import {
  useGooHover,
  useGooIds,
} from '@/app/(landing)/components/mothership/components/goo-marks/use-goo-hover'

/**
 * Sim circle goo-mark: GRID-9.
 * 3x3 lattice of overlapping circles, centers spaced one radius apart
 * (circle radius 16), with intersection dots (r2.2, gradient fill) on the
 * 9 lattice nodes.
 */
export interface Grid9Props {
  size?: number
  className?: string
  /** Show the 9 intersection dots (default true). */
  dots?: boolean
  animate?: boolean
  forceHover?: boolean
}

export function Grid9({
  size = 110,
  className,
  dots = true,
  animate = true,
  forceHover = false,
}: Grid9Props) {
  const { amt, bind } = useGooHover({ animate, forceHover })
  const { gradId, gooId } = useGooIds()

  const cx = 50
  const cy = 50
  const r = 16
  const offs = [-r, 0, r]
  const dotR = 2.2 * (1 + amt * 0.5)

  const circles: ReactNode[] = []
  const nodeDots: ReactNode[] = []
  let i = 0
  for (const oy of offs) {
    for (const ox of offs) {
      const x = (cx + ox).toFixed(2)
      const y = (cy + oy).toFixed(2)
      circles.push(<circle key={`c${i}`} cx={x} cy={y} r={r} />)
      nodeDots.push(
        <circle
          key={`d${i}`}
          cx={x}
          cy={y}
          r={dotR.toFixed(2)}
          fill={`url(#${gradId})`}
          stroke='none'
        />
      )
      i++
    }
  }

  return (
    <GooMarkSvg
      size={size}
      gradId={gradId}
      gooId={gooId}
      ariaLabel='Grid-9'
      bind={bind}
      className={className}
      dots={dots ? nodeDots : undefined}
    >
      {circles}
    </GooMarkSvg>
  )
}
