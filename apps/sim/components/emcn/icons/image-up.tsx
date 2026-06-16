import type { SVGProps } from 'react'

/**
 * ImageUp icon component - picture frame with sun and mountain silhouette.
 * Universal "image" glyph used for actions that set or upload an image
 * (e.g., workspace logo).
 * @param props - SVG properties including className, fill, etc.
 */
export function ImageUp(props: SVGProps<SVGSVGElement>) {
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
      aria-hidden='true'
      {...props}
    >
      <rect x='0.75' y='0.75' width='18.5' height='18' rx='2.5' />
      <circle cx='6.25' cy='6.25' r='1.75' />
      <path d='M17.25 12.75L12.25 7.75L2.75 17.25' />
    </svg>
  )
}
