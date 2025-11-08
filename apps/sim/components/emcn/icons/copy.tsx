import type { SVGProps } from 'react'
import styles from './animate/copy.module.css'

export interface CopyProps extends SVGProps<SVGSVGElement> {
  /**
   * Enable animation on the copy icon
   * @default false
   */
  animate?: boolean
}

/**
 * Copy icon component with optional CSS-based animation
 * When animate is false, this is a lightweight static icon with no animation overhead.
 * When animate is true, CSS module animations are applied to swap the rectangles.
 * @param props - SVG properties including className, animate, etc.
 */
export function Copy({ animate = false, className, ...props }: CopyProps) {
  const svgClassName = animate
    ? `${styles['animated-copy-svg']} ${className || ''}`.trim()
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
      <rect
        width='14'
        height='14'
        x='8'
        y='8'
        rx='2'
        ry='2'
        className={animate ? styles['rect-bottom-right'] : undefined}
      />
      <path
        d='M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'
        className={animate ? styles['rect-top-left'] : undefined}
      />
    </svg>
  )
}
