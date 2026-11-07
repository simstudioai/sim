import type { SVGProps } from 'react'

/**
 * ChevronLeft icon component - single chevron pointing left
 * @param props - SVG properties including className, fill, etc.
 */
export function ChevronLeft(props: SVGProps<SVGSVGElement>) {
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
      <path d='M13.25 3L6.25 10.25L13.25 17.5' />
    </svg>
  )
}
