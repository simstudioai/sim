import type { SVGProps } from 'react'

/**
 * ArrowUpRight icon component - diagonal arrow pointing to the upper-right corner.
 * Drawn at the footprint of ArrowRight (an 11-unit span centered on the house
 * box), so beside a 16px chip icon it reads as a glyph, not a frame.
 * @param props - SVG properties including className, fill, etc.
 */
export function ArrowUpRight(props: SVGProps<SVGSVGElement>) {
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
      <path d='M6.75 4.75H15.75V13.75' />
      <path d='M4.75 15.75L15.75 4.75' />
    </svg>
  )
}
