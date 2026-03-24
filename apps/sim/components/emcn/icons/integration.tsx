import type { SVGProps } from 'react'

/**
 * Integration icon component - two connected blocks
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
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <rect x='1' y='6.5' width='7' height='7' rx='1.5' />
      <rect x='14' y='6.5' width='7' height='7' rx='1.5' />
      <path d='M8 10H14' />
    </svg>
  )
}
