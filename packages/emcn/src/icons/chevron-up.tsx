import type { SVGProps } from 'react'

/**
 * ChevronUp icon component - single chevron pointing up
 * @param props - SVG properties including className, fill, etc.
 */
export function ChevronUp(props: SVGProps<SVGSVGElement>) {
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
      <path d='M3 13.25L10.25 6.25L17.5 13.25' />
    </svg>
  )
}
