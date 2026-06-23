'use client'

import type { ReactNode } from 'react'
import { GooMarkSvg } from '@/app/(landing)/components/mothership/components/goo-marks/goo-mark-svg'
import {
  useGooHover,
  useGooIds,
} from '@/app/(landing)/components/mothership/components/goo-marks/use-goo-hover'

/**
 * Sim circle goo-mark: FAN RINGS.
 * 5 same-size circles (radius 30), centers stepped horizontally by 9,
 * symmetric about center — fuses into a vesica weave through the middle.
 */
export interface FanRingsProps {
  size?: number
  className?: string
  animate?: boolean
  forceHover?: boolean
}

export function FanRings({
  size = 110,
  className,
  animate = true,
  forceHover = false,
}: FanRingsProps) {
  const { amt, bind } = useGooHover({ animate, forceHover })
  const { gradId, gooId } = useGooIds()

  const cx = 50
  const cy = 50
  const r = 30
  const n = 5
  const sp = 9 * (1 + amt * 0.25)
  const start = -((n - 1) / 2) * sp

  const circles: ReactNode[] = []
  for (let i = 0; i < n; i++) {
    circles.push(<circle key={i} cx={(cx + start + i * sp).toFixed(2)} cy={cy} r={r} />)
  }

  return (
    <GooMarkSvg
      size={size}
      gradId={gradId}
      gooId={gooId}
      ariaLabel='Fan rings'
      bind={bind}
      className={className}
    >
      {circles}
    </GooMarkSvg>
  )
}
