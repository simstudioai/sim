import type { SVGProps } from 'react'

/**
 * Pause icon component - two vertical bars
 * @param props - SVG properties including className, fill, etc.
 */
export function Pause(props: SVGProps<SVGSVGElement>) {
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
      <path d='M6.25 2.75V16.75' />
      <path d='M14.25 2.75V16.75' />
    </svg>
  )
}
