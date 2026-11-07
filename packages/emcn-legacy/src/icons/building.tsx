import type { SVGProps } from 'react'

/**
 * Building icon component - office tower with windows and a shorter annex
 * @param props - SVG properties including className, fill, etc.
 */
export function Building(props: SVGProps<SVGSVGElement>) {
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
      <rect x='8.6' y='1.1' width='10.3' height='17.3' rx='2' />
      <path d='M8.6 9H3.6C2.5 9 1.6 9.9 1.6 11V16.4C1.6 17.5 2.5 18.4 3.6 18.4H8.6' />
      <path d='M11.2 5.1H12.3M15.2 5.1H16.3M11.2 9.3H12.3M15.2 9.3H16.3M11.2 13.5H12.3M15.2 13.5H16.3' />
    </svg>
  )
}
