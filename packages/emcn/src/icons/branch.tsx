import type { SVGProps } from 'react'

/**
 * Branch icon component - a line forking off a trunk, for environments forked from one another
 * @param props - SVG properties including className, fill, etc.
 */
export function Branch(props: SVGProps<SVGSVGElement>) {
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
      <path d='M4.75 0.75V12.75' />
      <circle cx='15.75' cy='4.25' r='2.5' />
      <circle cx='4.75' cy='15.25' r='2.5' />
      <path d='M15.75 6.75A8.5 8.5 0 0 1 7.25 15.25' />
    </svg>
  )
}
