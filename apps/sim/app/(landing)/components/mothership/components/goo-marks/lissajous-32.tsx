'use client'

import { GooMarkSvg } from '@/app/(landing)/components/mothership/components/goo-marks/goo-mark-svg'
import {
  normalizeReach,
  type Pt,
  sampleClosed,
  toPath,
  useGooHover,
  useGooIds,
} from '@/app/(landing)/components/mothership/components/goo-marks/use-goo-hover'

/**
 * Sim circle goo-mark: LISSAJOUS 3:2.
 * x = 50 + 40·sin(3t + π/2),  y = 50 + 40·sin(2t)
 */
export interface Lissajous32Props {
  size?: number
  className?: string
  animate?: boolean
  forceHover?: boolean
}

export function Lissajous32({
  size = 110,
  className,
  animate = true,
  forceHover = false,
}: Lissajous32Props) {
  const { amt, bind } = useGooHover({ animate, forceHover })
  const { gradId, gooId } = useGooIds()

  const phase = Math.PI / 2 + amt * 0.4
  const fn = (t: number): Pt => [50 + 40 * Math.sin(3 * t + phase), 50 + 40 * Math.sin(2 * t)]
  const d = toPath(normalizeReach(sampleClosed(fn)))

  return (
    <GooMarkSvg
      size={size}
      gradId={gradId}
      gooId={gooId}
      ariaLabel='Lissajous 3:2'
      bind={bind}
      className={className}
    >
      <path d={d} />
    </GooMarkSvg>
  )
}
