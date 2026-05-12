import type { SVGProps } from 'react'

/**
 * Table-X icon component - grid table with an X mark indicating a missing or deleted table
 * @param props - SVG properties including className, fill, etc.
 */
export function TableX(props: SVGProps<SVGSVGElement>) {
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
      aria-hidden='true'
      {...props}
    >
      <path d='M0.75 12.5V3.25C0.75 1.87 1.87 0.75 3.25 0.75H17.25C18.63 0.75 19.75 1.87 19.75 3.25V16.25C19.75 17.63 18.63 18.75 17.25 18.75H7.5' />
      <path d='M0.75 6.75H19.75' />
      <path d='M0.75 12.75H19.75' />
      <path d='M10.25 0.75V18.75' />
      <path d='M1 16L5 20' />
      <path d='M5 16L1 20' />
    </svg>
  )
}
