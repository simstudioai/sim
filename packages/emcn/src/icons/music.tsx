import type { SVGProps } from 'react'

/**
 * Music icon component - two eighth notes joined by a single beam
 * @param props - SVG properties including className, fill, etc.
 */
export function Music(props: SVGProps<SVGSVGElement>) {
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
      <path d='M7.6 14.75V2.15H18.1V14.75' />
      <circle cx='5' cy='14.75' r='2.6' />
      <circle cx='15.5' cy='14.75' r='2.6' />
    </svg>
  )
}
