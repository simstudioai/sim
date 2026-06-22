import type { ReactNode } from 'react'
import { GooDefs } from '@/app/(landing)/components/mothership/components/goo-marks/goo-defs'
import {
  GOO_FUSION,
  STROKE,
} from '@/app/(landing)/components/mothership/components/goo-marks/use-goo-hover'

/**
 * Shared `<svg>` shell for the circle goo marks. Children are the stroke
 * `<path>`/`<circle>` elements (plus optional plain dots). Applies the gradient
 * stroke + goo filter.
 */
interface GooMarkSvgProps {
  size: number
  gradId: string
  gooId: string
  ariaLabel: string
  bind?: Record<string, () => void>
  children: ReactNode
  dots?: ReactNode
  gooFusion?: number
  className?: string
}

export function GooMarkSvg({
  size,
  gradId,
  gooId,
  ariaLabel,
  bind,
  children,
  dots,
  gooFusion = GOO_FUSION,
  className,
}: GooMarkSvgProps) {
  return (
    <svg
      viewBox='0 0 100 100'
      width={size}
      height={size}
      role='img'
      aria-label={ariaLabel}
      className={className}
      style={{ display: 'block', outline: 'none' }}
      {...bind}
    >
      <GooDefs gradId={gradId} gooId={gooId} gooFusion={gooFusion} />
      <g
        filter={`url(#${gooId})`}
        stroke={`url(#${gradId})`}
        strokeWidth={STROKE}
        strokeLinecap='round'
        strokeLinejoin='round'
        fill='none'
      >
        {children}
      </g>
      {dots ? <g>{dots}</g> : null}
    </svg>
  )
}
