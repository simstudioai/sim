import type { SVGProps } from 'react'

/**
 * SquareArrowUpRight icon — a rounded square with an arrow pointing top-right inside it.
 * @param props - SVG properties including className, fill, etc.
 */
export function SquareArrowUpRight(props: SVGProps<SVGSVGElement>) {
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
      <rect x='1.25' y='0.75' width='18' height='18' rx='2.5' />
      <path d='M9.75 5.25H14.25V9.75' />
      <path d='M14.25 5.25L6.25 14.25' />
    </svg>
  )
}
