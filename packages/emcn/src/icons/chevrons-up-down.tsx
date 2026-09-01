import type { SVGProps } from 'react'

/**
 * ChevronsUpDown icon component - stacked chevrons pointing away from each other
 * @param props - SVG properties including className, fill, etc.
 */
export function ChevronsUpDown(props: SVGProps<SVGSVGElement>) {
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
      <path d='M5.75 6.75L10.25 2.25L14.75 6.75' />
      <path d='M5.75 12.75L10.25 17.25L14.75 12.75' />
    </svg>
  )
}
