import type { SVGProps } from 'react'

/**
 * ChevronDown icon component
 * @param props - SVG properties including className, fill, etc.
 */
export function ChevronDown(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='10'
      height='6'
      viewBox='0 0 10 6'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path
        d='M1 1L5 5L9 1'
        stroke='currentColor'
        strokeWidth='1.33'
        strokeLinecap='square'
        strokeLinejoin='miter'
        fill='none'
      />
    </svg>
  )
}
