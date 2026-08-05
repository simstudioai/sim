import type { SVGProps } from 'react'

/** Diagonal inward arrows used to exit an expanded editing surface. */
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
        d='M21 3L14 10'
        stroke='currentColor'
        strokeWidth='1.55'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M14 4V10H20'
        stroke='currentColor'
        strokeWidth='1.55'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M3 21L10 14'
        stroke='currentColor'
        strokeWidth='1.55'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M10 20V14H4'
        stroke='currentColor'
        strokeWidth='1.55'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
