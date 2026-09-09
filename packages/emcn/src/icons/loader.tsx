'use client'

import { type SVGProps, useId } from 'react'
import { cn } from '../lib/cn'
import styles from './animate/relay-loader.module.css'

export interface LoaderProps extends SVGProps<SVGSVGElement> {
  /**
   * Enable the relay animation. Otherwise the dot rests between the bars.
   * @default false
   */
  animate?: boolean
}

/**
 * Shared loading indicator: a dot travels between two bars with a gooey merge.
 * Inherits the caller's color and sizing; reduced motion keeps the dot still.
 */
export function Loader({ animate = false, className, ...props }: LoaderProps) {
  const id = useId().replace(/[^a-zA-Z0-9-]/g, '')
  const filterId = `loader-relay-${id}`

  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 100 100'
      fill='currentColor'
      className={className}
      aria-hidden='true'
      {...props}
    >
      <defs>
        <filter
          id={filterId}
          x='-30%'
          y='-30%'
          width='160%'
          height='160%'
          colorInterpolationFilters='sRGB'
        >
          <feGaussianBlur in='SourceGraphic' stdDeviation='5' result='blur' />
          <feColorMatrix
            in='blur'
            values='1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9'
            result='goo'
          />
          <feColorMatrix
            in='goo'
            values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 127 0'
            result='gooAlpha'
          />
          <feGaussianBlur in='gooAlpha' stdDeviation='4.86' result='innerBlur' />
          <feComposite
            in='innerBlur'
            in2='gooAlpha'
            operator='arithmetic'
            k2='-1'
            k3='1'
            result='innerMask'
          />
          <feFlood className={styles.glow} result='glowColor' />
          <feComposite in='glowColor' in2='innerMask' operator='in' result='glow' />
          <feMerge>
            <feMergeNode in='goo' />
            <feMergeNode in='glow' />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${filterId})`} fill='currentColor' stroke='none'>
        <rect x='13' y='28' width='16' height='44' />
        <rect x='71' y='28' width='16' height='44' />
        <circle className={cn(styles.ball, animate && styles.animated)} cx='21' cy='50' r='14' />
      </g>
    </svg>
  )
}
