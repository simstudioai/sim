import type { SVGProps } from 'react'

/**
 * Users icon component - two person silhouettes side by side
 * @param props - SVG properties including className, fill, etc.
 */
export function Users(props: SVGProps<SVGSVGElement>) {
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
      <circle cx='7.5' cy='6' r='3.75' />
      <path d='M0.75 18.25C0.75 14.52 3.77 11.5 7.5 11.5C11.23 11.5 14.25 14.52 14.25 18.25' />
      <circle cx='15.75' cy='6.75' r='2.75' />
      <path d='M15.25 12.25C17.73 12.25 19.75 14.94 19.75 18.25' />
    </svg>
  )
}
