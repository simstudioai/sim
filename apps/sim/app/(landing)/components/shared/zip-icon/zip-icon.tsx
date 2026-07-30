import type { SVGProps } from 'react'

/**
 * Generic zip-archive glyph shared by the landing files surfaces (the
 * homepage files preview and the files hero loop) - no dedicated zip
 * component exists in the icon set. Inherits `currentColor` and sizes via
 * className, matching the icon-set convention.
 */
export function ZipIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      {...props}
    >
      <path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' />
      <path d='M14 2v4a2 2 0 0 0 2 2h4' />
      <path d='M10 6h1' />
      <path d='M10 10h1' />
      <path d='M10 14h1' />
      <path d='M9 18h2v2h-2z' />
    </svg>
  )
}
