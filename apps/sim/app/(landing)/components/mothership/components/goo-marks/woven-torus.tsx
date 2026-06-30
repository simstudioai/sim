'use client'

import type { ReactNode } from 'react'
import { GooMarkSvg } from '@/app/(landing)/components/mothership/components/goo-marks/goo-mark-svg'
import {
  REACH,
  TAU,
  useGooHover,
  useGooIds,
} from '@/app/(landing)/components/mothership/components/goo-marks/use-goo-hover'

/**
 * Sim circle goo-mark: WOVEN TORUS.
 * 3 offset rings (radius 22) whose centers sit on a small circle 120° apart -
 * reads as orbit / motion.
 */
export interface WovenTorusProps {
  size?: number
  className?: string
  animate?: boolean
  forceHover?: boolean
}

export function WovenTorus({
  size = 110,
  className,
  animate = true,
  forceHover = false,
}: WovenTorusProps) {
  const { amt, bind } = useGooHover({ animate, forceHover })
  const { gradId, gooId } = useGooIds()

  const cr = 22
  const rot = amt * (TAU / 12)

  const circles: ReactNode[] = []
  for (let i = 0; i < 3; i++) {
    const off = (i * (REACH - cr)) / 2
    const ang = i * (TAU / 3) + rot
    circles.push(
      <circle
        key={i}
        cx={(50 + off * Math.cos(ang)).toFixed(2)}
        cy={(50 + off * Math.sin(ang)).toFixed(2)}
        r={cr}
      />
    )
  }

  return (
    <GooMarkSvg
      size={size}
      gradId={gradId}
      gooId={gooId}
      ariaLabel='Woven torus'
      bind={bind}
      className={className}
    >
      {circles}
    </GooMarkSvg>
  )
}
