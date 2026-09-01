import type { SVGProps } from 'react'

/**
 * Trash icon component - lidded bin
 * @param props - SVG properties including className, fill, etc.
 */
export function Trash(props: SVGProps<SVGSVGElement>) {
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
      <path d='M0.75 4.75H19.75' />
      <path d='M3.25 4.75V16.25C3.25 17.63 4.37 18.75 5.75 18.75H14.75C16.13 18.75 17.25 17.63 17.25 16.25V4.75' />
      <path d='M7.25 4.75V3.25C7.25 2.15 8.15 1.25 9.25 1.25H11.25C12.35 1.25 13.25 2.15 13.25 3.25V4.75' />
    </svg>
  )
}
