import type { SVGProps } from 'react'

/**
 * Brain icon component - two mirrored lobed halves joined by a central seam
 * @param props - SVG properties including className, fill, etc.
 */
export function Brain(props: SVGProps<SVGSVGElement>) {
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
      <path d='M10.25 1.6C7.8 0.7 5.4 1.4 4.6 4.1C1 4.9 0.9 8.2 4 9.4C0.9 10.5 1.2 13.8 4.6 14.7C5.2 17.5 7.7 18.7 10.25 18.1' />
      <path d='M10.25 1.6C12.7 0.7 15.1 1.4 15.9 4.1C19.5 4.9 19.6 8.2 16.5 9.4C19.6 10.5 19.3 13.8 15.9 14.7C15.3 17.5 12.8 18.7 10.25 18.1' />
      <path d='M10.25 1.6V18.1' />
    </svg>
  )
}
