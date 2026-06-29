import type { SVGProps } from 'react'

/**
 * UserPlus icon component — person silhouette with a plus sign in the bottom-right
 * @param props - SVG properties including className, fill, etc.
 */
export function UserPlus(props: SVGProps<SVGSVGElement>) {
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
      <path d='M4.5 5A2.5 2.5 0 1 0 9.5 5A2.5 2.5 0 1 0 4.5 5Z' />
      <path d='M3 17V14A3 3 0 0 1 6 11H8A3 3 0 0 1 11 14' />
      <path d='M15.5 13V17' />
      <path d='M13.5 15H17.5' />
    </svg>
  )
}
