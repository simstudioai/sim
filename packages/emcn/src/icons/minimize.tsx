import type { SVGProps } from 'react'

/** Inward arrows for restoring an expanded pane. */
export function Minimize(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path
        d='M14 4V10H20M4 14H10V20M21 3L14 10M3 21L10 14'
        stroke='currentColor'
        strokeWidth='1.55'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
