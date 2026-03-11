import type { SVGProps } from 'react'

/**
 * Hammer icon component - build/construction tool
 * @param props - SVG properties including className, fill, etc.
 */
export function Hammer(props: SVGProps<SVGSVGElement>) {
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
      <path d='M7 6.75L10.25 3.5L16.75 10L13.5 13.25Z' />
      <path d='M10.25 10L3.25 17' />
    </svg>
  )
}
