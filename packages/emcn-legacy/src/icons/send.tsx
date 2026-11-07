import type { SVGProps } from 'react'

/**
 * Send icon component - paper plane
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
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M19.25 1.25L12.5 18.25L9 10.5L1.25 7.25L19.25 1.25Z' />
      <path d='M19.25 1.25L9 10.5' />
    </svg>
  )
}
