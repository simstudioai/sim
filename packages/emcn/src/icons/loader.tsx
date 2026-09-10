'use client'

import { type SVGProps, useId } from 'react'
import { cn } from '@sim/emcn'
import styles from '@sim/emcn/icons/animate/ring-loader.module.css'

/** Ease the compact highlight into the track without a visible cutoff. */
const HIGHLIGHT_STOPS = Array.from({ length: 17 }, (_, index) => {
  const progress = index / 16
  return {
    offset: `${progress * 40}%`,
    opacity: 1 - progress * progress * (3 - 2 * progress),
  }
})

export interface LoaderProps extends SVGProps<SVGSVGElement> {
  /**
   * Enable the weighted rotation. Otherwise the highlight rests at the top of the ring.
   * @default false
   */
  animate?: boolean
}

/**
 * Shared loading ring with a fading highlight that accelerates downward and slows on the climb.
 * Inherits the caller's color and sizing; reduced motion holds the highlight still.
 */
export function Loader({ animate = false, className, ...props }: LoaderProps) {
  const id = useId().replace(/[^a-zA-Z0-9-]/g, '')
  const gradientId = `loader-highlight-${id}`

  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      className={className}
      aria-hidden='true'
      {...props}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1='12'
          y1='1'
          x2='12'
          y2='23'
          gradientUnits='userSpaceOnUse'
        >
          {HIGHLIGHT_STOPS.map(({ offset, opacity }) => (
            <stop key={offset} offset={offset} stopColor='currentColor' stopOpacity={opacity} />
          ))}
          <stop offset='1' stopColor='currentColor' stopOpacity='0' />
        </linearGradient>
      </defs>
      <circle cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='2' opacity='.25' />
      <circle
        className={cn(styles.highlight, animate && styles.animated)}
        cx='12'
        cy='12'
        r='10'
        stroke={`url(#${gradientId})`}
        strokeWidth='2'
      />
    </svg>
  )
}
