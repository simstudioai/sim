import type { SVGProps } from 'react'

/**
 * Integration icon component - two overlapping rounded squares, diagonally offset.
 * @param props - SVG properties including className, fill, etc.
 */
export function Integration(props: SVGProps<SVGSVGElement>) {
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
      <rect x='1.5' y='1' width='12' height='12' rx='2' />
      <rect x='8.5' y='8' width='12' height='12' rx='2' />
    </svg>
  )
}
