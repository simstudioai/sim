import type { SVGProps } from 'react'

/**
 * SquareArrowUpRight icon — a rounded square with an arrow exiting the top-right corner.
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
      <path d='M13.5 1.5H19V7' />
      <path d='M19 1.5L10.25 10.25' />
      <path d='M16.5 11.5V16.5C16.5 17.6046 15.6046 18.5 14.5 18.5H4C2.89543 18.5 2 17.6046 2 16.5V6C2 4.89543 2.89543 4 4 4H9' />
    </svg>
  )
}
