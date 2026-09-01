import type { SVGProps } from 'react'

/**
 * Compass icon component - dial with a two-tone needle pointing north-east
 * @param props - SVG properties including className, fill, etc.
 */
export function Compass(props: SVGProps<SVGSVGElement>) {
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
      <circle cx='10.25' cy='9.75' r='8' />
      <path d='M14.21 5.79L12.23 11.73L6.29 13.71L8.27 7.77Z' />
      <path d='M8.27 7.77L12.23 11.73' />
    </svg>
  )
}
