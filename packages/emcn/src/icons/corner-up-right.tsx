import type { SVGProps } from 'react'

export function CornerUpRight(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M15 14L20 9L15 4' />
      <path d='M4 20V13C4 10.79 5.79 9 8 9H20' />
    </svg>
  )
}
