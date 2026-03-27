import type { SVGProps } from 'react'

/**
 * UserPlus icon component — person silhouette with a plus sign for invite actions
 * @param props - SVG properties including className, fill, etc.
 */
export function UserPlus(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' />
      <path d='M9 3a4 4 0 1 0 0 8 4 4 0 1 0 0-8' />
      <path d='M19 8v6' />
      <path d='M16 11h6' />
    </svg>
  )
}
