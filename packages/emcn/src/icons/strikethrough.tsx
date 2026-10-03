import type { SVGProps } from 'react'

/**
 * Strikethrough icon component - capital S cut by a full-width horizontal rule
 * @param props - SVG properties including className, fill, etc.
 */
export function Strikethrough(props: SVGProps<SVGSVGElement>) {
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
      <path d='M15.89 3.91A6 4.35 0 1 0 10.25 9.75A6 4.35 0 1 1 4.61 15.59' />
      <path d='M2.25 9.75H18.25' />
    </svg>
  )
}
