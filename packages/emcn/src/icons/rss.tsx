import type { SVGProps } from 'react'

/**
 * Rss icon component - two concentric quarter arcs radiating from a corner dot
 * @param props - SVG properties including className, fill, etc.
 */
export function Rss(props: SVGProps<SVGSVGElement>) {
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
      <path d='M3.45 8.15A8.4 8.4 0 0 1 11.85 16.55' />
      <path d='M3.45 1.75A14.8 14.8 0 0 1 18.25 16.55' />
      <circle cx='3.45' cy='16.55' r='1.2' />
    </svg>
  )
}
