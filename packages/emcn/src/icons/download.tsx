import type { SVGProps } from 'react'
import { cn } from '../lib/cn'
import styles from './animate/download.module.css'

export interface DownloadProps extends SVGProps<SVGSVGElement> {
  /**
   * Enable animation on the download icon
   * @default false
   */
  animate?: boolean
}

/**
 * Download icon — arrow pointing down into a tray, mirroring the Upload icon.
 * Uses the same viewBox, stroke weight, and path style as Upload for visual consistency.
 */
export function Download({ animate = false, className, ...props }: DownloadProps) {
  const svgClassName = cn(animate && styles['animated-download-svg'], className)

  return (
    <svg
      width='24'
      height='24'
      viewBox='-1 -2 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      className={svgClassName}
      aria-hidden='true'
      {...props}
    >
      {/* tray — same as Upload */}
      <path d='M0.75 12.75V16.75C0.75 17.8546 1.64543 18.75 2.75 18.75H17.75C18.8546 18.75 19.75 17.8546 19.75 16.75V12.75' />
      {/* stem — top to tray */}
      <path d='M10.25 1.75V12.75' />
      {/* arrowhead pointing down */}
      <path d='M5.25 7.75L10.25 12.75L15.25 7.75' />
    </svg>
  )
}
