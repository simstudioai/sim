import type { SVGProps } from 'react'

/**
 * ArrowUpLeft icon component - diagonal arrow pointing to the upper-left corner
 * @param props - SVG properties including className, fill, etc.
 */
export function ArrowUpLeft(props: SVGProps<SVGSVGElement>) {
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
      <path d='M2.75 17.25V2.25H17.75' />
      <path d='M17.75 17.25L2.75 2.25' />
    </svg>
  )
}
