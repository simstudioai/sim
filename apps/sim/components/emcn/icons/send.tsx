import type { SVGProps } from 'react'

/**
 * Send icon component - paper plane / arrow
 * @param props - SVG properties including className, fill, etc.
 */
export function Send(props: SVGProps<SVGSVGElement>) {
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
      <path d='M19.5 1.5L9 12' />
      <path d='M19.5 1.5L13.5 19.5L9 12L1.5 8.5L19.5 1.5Z' />
    </svg>
  )
}
