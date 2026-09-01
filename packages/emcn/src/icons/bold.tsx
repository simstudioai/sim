import type { SVGProps } from 'react'

/**
 * Bold icon component - capital B with a vertical stem and two stacked bowls
 * @param props - SVG properties including className, fill, etc.
 */
export function Bold(props: SVGProps<SVGSVGElement>) {
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
      <path d='M4.15 1.25V18.25H12.1A4.25 4.25 0 0 0 12.1 9.75H4.15' />
      <path d='M4.15 1.25H11.1A4.25 4.25 0 0 1 11.1 9.75' />
    </svg>
  )
}
