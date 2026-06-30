'use client'

import { GooMarkSvg } from '@/app/(landing)/components/mothership/components/goo-marks/goo-mark-svg'
import {
  REACH,
  TAU,
  useGooHover,
  useGooIds,
} from '@/app/(landing)/components/mothership/components/goo-marks/use-goo-hover'

/**
 * Sim circle goo-mark: FLOWER OF LIFE.
 * 7 circles - 1 center + 6 on a hexagon at radius 20 - each radius 20,
 * scaled so the outer circle edges land on REACH.
 */
export interface FlowerOfLifeProps {
  size?: number
  className?: string
  animate?: boolean
  forceHover?: boolean
}

export function FlowerOfLife({
  size = 110,
  className,
  animate = true,
  forceHover = false,
}: FlowerOfLifeProps) {
  const { amt, bind } = useGooHover({ animate, forceHover })
  const { gradId, gooId } = useGooIds()

  const cx = 50
  const cy = 50
  const hexR = 20
  const cr = 20
  const k = REACH / (hexR + cr)
  const crS = cr * k
  const breathe = 1 + amt * 0.06
  const centers: [number, number][] = [[cx, cy]]
  for (let i = 0; i < 6; i++) {
    const a = i * (TAU / 6)
    centers.push([cx + hexR * Math.cos(a), cy + hexR * Math.sin(a)])
  }

  return (
    <GooMarkSvg
      size={size}
      gradId={gradId}
      gooId={gooId}
      ariaLabel='Flower of life'
      bind={bind}
      className={className}
    >
      {centers.map(([x, y], i) => {
        const nx = cx + (x - cx) * k
        const ny = cy + (y - cy) * k
        return (
          <circle key={i} cx={nx.toFixed(2)} cy={ny.toFixed(2)} r={(crS * breathe).toFixed(2)} />
        )
      })}
    </GooMarkSvg>
  )
}
