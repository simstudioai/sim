import type { SVGProps } from 'react'

/**
 * X icon component - close / clear / dismiss
 * @param props - SVG properties including className, fill, etc.
 */
export function X(props: SVGProps<SVGSVGElement>) {
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
      <path d='M15.25 4.75L4.75 15.25' />
      <path d='M4.75 4.75L15.25 15.25' />
    </svg>
  )
}
