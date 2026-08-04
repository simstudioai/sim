import type { SVGProps } from 'react'

/**
 * Box icon component - isometric 3D cube
 * @param props - SVG properties including className, fill, etc.
 */
export function Box(props: SVGProps<SVGSVGElement>) {
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
      <path d='M10.25 1.05L18.25 5.4V14.1L10.25 18.45L2.25 14.1V5.4Z' />
      <path d='M2.25 5.4L10.25 9.75L18.25 5.4' />
      <path d='M10.25 9.75V18.45' />
    </svg>
  )
}
