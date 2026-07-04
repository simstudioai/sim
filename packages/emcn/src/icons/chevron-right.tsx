import type { SVGProps } from 'react'

/**
 * ChevronRight icon component
 * @param props - SVG properties including className, fill, etc.
 */
export function ChevronRight(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='6'
      height='10'
      viewBox='0 0 6 10'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path
        d='M1 1L5 5L1 9'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinecap='square'
        strokeLinejoin='miter'
        fill='none'
      />
    </svg>
  )
}
