import type { SVGProps } from 'react'

/**
 * User icon component - single person silhouette
 * @param props - SVG properties including className, fill, etc.
 */
export function User(props: SVGProps<SVGSVGElement>) {
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
      aria-hidden='true'
      {...props}
    >
      <circle cx='10.25' cy='6.25' r='4' />
      <path d='M2.25 18.75C2.25 14.3317 5.83172 10.75 10.25 10.75C14.6683 10.75 18.25 14.3317 18.25 18.75' />
    </svg>
  )
}
