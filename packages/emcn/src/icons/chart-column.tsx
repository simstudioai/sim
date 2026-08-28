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
      <path d='M2.51 2.01V15.77C2.51 16.72 3.28 17.49 4.23 17.49H17.99' />
      <rect x='12.83' y='3.73' width='3.44' height='10.32' rx='0.86' />
      <rect x='5.95' y='6.31' width='3.44' height='7.74' rx='0.86' />
    </svg>
  )
}
