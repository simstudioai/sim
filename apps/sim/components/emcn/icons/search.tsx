import type { SVGProps } from 'react'

/**
 * Search icon component (magnifying glass)
 * @param props - SVG properties including className, fill, etc.
 */
export function Search(props: SVGProps<SVGSVGElement>) {
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
      {...props}
    >
      <circle cx='8.5' cy='8.5' r='7.5' />
      <path d='M14 14L18 18' />
    </svg>
  )
}
