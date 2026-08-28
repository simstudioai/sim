import type { SVGProps } from 'react'

/**
 * ChartColumn icon component - an axis with two columns, for usage and analytics
 * surfaces
 * @param props - SVG properties including className, fill, etc.
 */
export function ChartColumn(props: SVGProps<SVGSVGElement>) {
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
      <path d='M1.25 0.75V16.75C1.25 17.855 2.145 18.75 3.25 18.75H19.25' />
      <rect x='13.25' y='2.75' width='4' height='12' rx='1' />
      <rect x='5.25' y='5.75' width='4' height='9' rx='1' />
    </svg>
  )
}
