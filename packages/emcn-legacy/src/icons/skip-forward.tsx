import type { SVGProps } from 'react'

/**
 * SkipForward icon component - right-facing triangle against an end bar
 * @param props - SVG properties including className, fill, etc.
 */
export function SkipForward(props: SVGProps<SVGSVGElement>) {
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
      <path d='M4.23 2.87L12.83 9.75L4.23 16.63Z' />
      <path d='M16.27 3.73V15.77' />
    </svg>
  )
}
