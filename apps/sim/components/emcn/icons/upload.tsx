import type { SVGProps } from 'react'

/**
 * Upload icon component - arrow pointing up with base line
 * @param props - SVG properties including className, fill, etc.
 */
export function Upload(props: SVGProps<SVGSVGElement>) {
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
      <path d='M10.25 14V3.5' />
      <path d='M5.75 8L10.25 3.5L14.75 8' />
      <path d='M3 17.5H17.5' />
    </svg>
  )
}
