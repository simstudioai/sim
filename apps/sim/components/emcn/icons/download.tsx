import type { SVGProps } from 'react'
import styles from '@/components/emcn/icons/animate/download.module.css'

export interface DownloadProps extends SVGProps<SVGSVGElement> {
  /**
   * Enable animation on the download icon
   * @default false
   */
  animate?: boolean
}

/**
 * Download icon component with optional CSS-based animation
 * Based on lucide arrow-down icon structure.
 * When animate is false, this is a lightweight static icon with no animation overhead.
 * When animate is true, CSS module animations are applied for a subtle pulsing effect.
 * @param props - SVG properties including className, animate, etc.
 */
export function Download({ animate = false, className, ...props }: DownloadProps) {
  const svgClassName = animate
    ? `${styles['animated-download-svg']} ${className || ''}`.trim()
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
      <path d='M12 5v14' />
      <path d='m19 12-7 7-7-7' />
    </svg>
  )
}
