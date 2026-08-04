import type { SVGProps } from 'react'

/**
 * Code icon component - two angle brackets pointing away from a shared centre
 * @param props - SVG properties including className, fill, etc.
 */
export function Code(props: SVGProps<SVGSVGElement>) {
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
      <path d='M7 4.25L2.25 9.75L7 15.25' />
      <path d='M13.5 4.25L18.25 9.75L13.5 15.25' />
    </svg>
  )
}
