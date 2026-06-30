'use client'

import { cn } from '@/lib/core/utils/cn'
import {
  normalizeReach,
  type Pt,
  sampleClosed,
  toPath,
  useGooHover,
  useGooIds,
} from '@/app/(landing)/components/mothership/components/goo-marks/use-goo-hover'
import { gradientForTone } from '@/app/(landing)/components/mothership/components/iso-marks/use-goo-mark'

/**
 * Sim circle goo-mark: LISSAJOUS MORPH (Context).
 * A Lissajous figure that morphs its frequency ratio on hover - 3:2 at rest
 * eases to 5:4, with a phase shift - so the curve reweaves itself. Self-contained
 * (its own gradient + goo defs) so it can carry its tuned stroke and constants
 * independently of the static Build Lissajous.
 */
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const REST = { a: 3, b: 2, phase: 1.5708 }
const HOVER = { a: 5, b: 4, phase: 3.16 }
const AMP = 40
const STROKE = 2.5
const GOO_FUSION = 1.5

export interface LissajousMorphProps {
  size?: number
  className?: string
  animate?: boolean
  forceHover?: boolean
}

export function LissajousMorph({
  size = 110,
  className,
  animate = true,
  forceHover = false,
}: LissajousMorphProps) {
  const { amt, bind } = useGooHover({ animate, forceHover })
  const { gradId, gooId } = useGooIds()

  const a = lerp(REST.a, HOVER.a, amt)
  const b = lerp(REST.b, HOVER.b, amt)
  const phase = lerp(REST.phase, HOVER.phase, amt)
  const fn = (t: number): Pt => [50 + AMP * Math.sin(a * t + phase), 50 + AMP * Math.sin(b * t)]
  const d = toPath(normalizeReach(sampleClosed(fn)))
  const { from, to } = gradientForTone(amt)

  return (
    <svg
      viewBox='0 0 100 100'
      width={size}
      height={size}
      aria-hidden='true'
      className={cn('block outline-none', className)}
      {...bind}
    >
      <defs>
        <radialGradient id={gradId} gradientUnits='userSpaceOnUse' cx='50' cy='50' r='44'>
          <stop stopColor={from} />
          <stop offset='1' stopColor={to} />
        </radialGradient>
        <filter id={gooId} x='-25%' y='-25%' width='150%' height='150%'>
          <feGaussianBlur in='SourceGraphic' stdDeviation={GOO_FUSION} result='b' />
          <feColorMatrix
            in='b'
            type='matrix'
            values='1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9'
          />
        </filter>
      </defs>
      <g
        filter={`url(#${gooId})`}
        stroke={`url(#${gradId})`}
        strokeWidth={STROKE}
        strokeLinecap='round'
        strokeLinejoin='round'
        fill='none'
      >
        <path d={d} />
      </g>
    </svg>
  )
}
