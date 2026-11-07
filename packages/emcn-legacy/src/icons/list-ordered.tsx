import type { SVGProps } from 'react'

/**
 * ListOrdered icon component - three lines, each preceded by the numerals 1, 2 and 3
 * @param props - SVG properties including className, fill, etc.
 */
export function ListOrdered(props: SVGProps<SVGSVGElement>) {
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
      <path d='M1.5 2.85L2.75 2V5.5M1.5 5.5H4' />
      <path d='M1.35 9.25A1.25 1.25 0 0 1 3.85 9.25C3.85 10.2 2.5 10.7 1.35 11.5H4' />
      <path d='M1.4 14.3C1.75 14.08 2.18 14 2.6 14A1.35 0.87 0 0 1 2.6 15.75A1.35 0.87 0 0 1 2.6 17.5C2.18 17.5 1.75 17.42 1.4 17.2' />
    </svg>
  )
}
