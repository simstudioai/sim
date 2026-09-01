import type { SVGProps } from 'react'

/**
 * ChevronsDownUp icon component - stacked chevrons pointing toward each other
 * @param props - SVG properties including className, fill, etc.
 */
export function ChevronsDownUp(props: SVGProps<SVGSVGElement>) {
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
      <path d='M5.75 2.25L10.25 6.75L14.75 2.25' />
      <path d='M5.75 17.25L10.25 12.75L14.75 17.25' />
    </svg>
  )
}
