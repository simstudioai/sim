import type { SVGProps } from 'react'

/**
 * Rows3 icon component - displays three horizontal rows in a rounded container
 * @param props - SVG properties including className, fill, etc.
 */
export function Rows3(props: SVGProps<SVGSVGElement>) {
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
      <path d='M0.75 3.25C0.75 1.86929 1.86929 0.75 3.25 0.75H17.25C18.6307 0.75 19.75 1.86929 19.75 3.25V16.25C19.75 17.6307 18.6307 18.75 17.25 18.75H3.25C1.86929 18.75 0.75 17.6307 0.75 16.25V3.25Z' />
      <path d='M0.75 6.75H19.75' />
      <path d='M0.75 12.75H19.75' />
    </svg>
  )
}
