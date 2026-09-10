'use client'

import type { SVGProps } from 'react'
import { cn } from '@sim/emcn'
import styles from '@sim/emcn/icons/animate/ring-loader.module.css'

export interface LoaderProps extends SVGProps<SVGSVGElement> {
  /**
   * Enable the weighted rotation. Otherwise the dot rests at the top of the ring.
   * @default false
   */
  animate?: boolean
}

/**
 * Shared loading ring with a dot that accelerates downward and slows on the climb.
 * Inherits the caller's color and sizing; reduced motion holds the dot still.
 */
export function Loader({ animate = false, className, ...props }: LoaderProps) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      className={cn(animate && styles.animated, className)}
      aria-hidden='true'
      {...props}
    >
      <circle cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' opacity='.25' />
      <circle cx='12' cy='2' r='2' fill='currentColor' />
    </svg>
  )
}
