import type { SVGProps } from 'react'

/**
 * Type email icon component - envelope for email columns
 * @param props - SVG properties including className, fill, etc.
 */
export function TypeEmail(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1.75 -1.5 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <rect x='2.25' y='4.5' width='16' height='12' rx='2' />
      <path d='M2.25 6.5L10.25 11.5L18.25 6.5' />
    </svg>
  )
}
