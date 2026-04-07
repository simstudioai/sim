import type { SVGProps } from 'react'

/**
 * Type number icon component - hash symbol for number columns
 * @param props - SVG properties including className, fill, etc.
 */
export function TypeNumber(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1.75 -1.5 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M3.25 7.25H17.75' />
      <path d='M2.75 13.75H17.25' />
      <path d='M8.25 1.25L6.25 19.75' />
      <path d='M14.25 1.25L12.25 19.75' />
    </svg>
  )
}
