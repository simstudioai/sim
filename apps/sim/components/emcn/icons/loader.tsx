import type { SVGProps } from 'react'
import styles from '@/components/emcn/icons/animate/loader.module.css'

export interface LoaderProps extends SVGProps<SVGSVGElement> {
  /**
   * Enable animation on the loader icon
   * @default false
   */
  animate?: boolean
}

/**
 * Loader icon component with optional CSS-based spinning animation
 * Based on refresh-cw but without the arrows, just the circular arcs.
 * When animate is false, this is a lightweight static icon with no animation overhead.
 * When animate is true, CSS module animations are applied for continuous spin.
 * @param props - SVG properties including className, animate, etc.
 */
export function Loader({ animate = false, className, ...props }: LoaderProps) {
  const svgClassName = animate
    ? `${styles['animated-loader-svg']} ${className || ''}`.trim()
    : className

  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      className={svgClassName}
      {...props}
    >
      <path d='M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74' />
      <path d='M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74' />
    </svg>
  )
}
