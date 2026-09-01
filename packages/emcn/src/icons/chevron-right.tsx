import type { SVGProps } from 'react'

/**
 * ChevronRight icon component - single chevron pointing right
 * @param props - SVG properties including className, fill, etc.
 */
export function ChevronRight(props: SVGProps<SVGSVGElement>) {
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
      <path d='M6.25 3L13.25 10.25L6.25 17.5' />
    </svg>
  )
}
