import type { SVGProps } from 'react'
import styles from '@/components/emcn/icons/animate/pills-ring.module.css'
import { cn } from '@/lib/core/utils/cn'

export interface PillsRingProps extends SVGProps<SVGSVGElement> {
  /**
   * Enable the chasing fade animation
   * @default false
   */
  animate?: boolean
}

const PILL_COUNT = 8
const DURATION_S = 1.2

/**
 * Ring of pill-shaped elements with optional chasing fade animation.
 * Static render shows pills at graded opacities; animated render
 * fades them sequentially around the ring via CSS module keyframes.
 * @param props - SVG properties including className, animate, etc.
 */
export function PillsRing({ animate = false, className, ...props }: PillsRingProps) {
  const svgClassName = cn(animate && styles['animated-pills-ring-svg'], className)

  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='currentColor'
      className={svgClassName}
      aria-hidden='true'
      {...props}
    >
      {Array.from({ length: PILL_COUNT }).map((_, i) => (
        <rect
          key={i}
          x='10.75'
          y='2.5'
          width='2.5'
          height='5'
          rx='1.25'
          transform={`rotate(${i * 45} 12 12)`}
          className={animate ? styles.pill : undefined}
          style={animate ? { animationDelay: `${(i * DURATION_S) / PILL_COUNT}s` } : undefined}
          opacity={animate ? undefined : 0.15 + (0.85 * (PILL_COUNT - i)) / PILL_COUNT}
        />
      ))}
    </svg>
  )
}
