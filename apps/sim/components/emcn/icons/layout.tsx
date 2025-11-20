import type { SVGProps } from 'react'
import styles from './animate/layout.module.css'

export type LayoutAnimationVariant = 'clockwise' | 'counterclockwise'

export interface LayoutProps extends SVGProps<SVGSVGElement> {
  /**
   * Enable animation on the layout icon
   * @default false
   */
  animate?: boolean
  /**
   * Animation direction variant (only applies when animate is true)
   * @default 'counterclockwise'
   */
  variant?: LayoutAnimationVariant
}

/**
 * Layout Dashboard icon component with optional CSS-based animation
 * When animate is false, this is a lightweight static icon with no animation overhead.
 * When animate is true, CSS module animations are applied.
 * @param props - SVG properties including className, animate, variant, etc.
 */
export function Layout({
  animate = false,
  variant = 'counterclockwise',
  className,
  ...props
}: LayoutProps) {
  const svgClassName = animate
    ? `${styles['animated-layout-svg']} ${variant === 'clockwise' ? styles.clockwise : ''} ${className || ''}`.trim()
    : className

  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      className={svgClassName}
      {...props}
    >
      <rect
        width='7'
        height='9'
        x='3'
        y='3'
        rx='1'
        className={animate ? styles['block-top-left'] : undefined}
      />
      <rect
        width='7'
        height='5'
        x='14'
        y='3'
        rx='1'
        className={animate ? styles['block-top-right'] : undefined}
      />
      <rect
        width='7'
        height='9'
        x='14'
        y='12'
        rx='1'
        className={animate ? styles['block-bottom-right'] : undefined}
      />
      <rect
        width='7'
        height='5'
        x='3'
        y='16'
        rx='1'
        className={animate ? styles['block-bottom-left'] : undefined}
      />
    </svg>
  )
}
