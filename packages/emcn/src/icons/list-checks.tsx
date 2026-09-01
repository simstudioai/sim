import type { SVGProps } from 'react'

/**
 * ListChecks icon component - three lines, each preceded by a checkmark
 * @param props - SVG properties including className, fill, etc.
 */
export function ListChecks(props: SVGProps<SVGSVGElement>) {
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
      <path d='M6 3.75H19M6 9.75H19M6 15.75H19' />
      <path d='M1.15 3.95L2.15 4.95L4.15 2.55M1.15 9.95L2.15 10.95L4.15 8.55M1.15 15.95L2.15 16.95L4.15 14.55' />
    </svg>
  )
}
