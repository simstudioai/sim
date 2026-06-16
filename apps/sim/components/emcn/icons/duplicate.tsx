import type { SVGProps } from 'react'

/**
 * Duplicate icon component - two overlapping rounded rectangles
 * @param props - SVG properties including className, fill, etc.
 */
export function Duplicate(props: SVGProps<SVGSVGElement>) {
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
      <path d='M14.25 0.75H2.75C1.64543 0.75 0.75 1.64543 0.75 2.75V14.25' />
      <rect x='5.25' y='5.25' width='14' height='14' rx='2' />
    </svg>
  )
}
