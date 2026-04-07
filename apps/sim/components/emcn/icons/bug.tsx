import type { SVGProps } from 'react'

/**
 * Bug icon component - debug beetle
 * @param props - SVG properties including className, fill, etc.
 */
export function Bug(props: SVGProps<SVGSVGElement>) {
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
      <path d='M6.25 4.75L4.25 2.75' />
      <path d='M14.25 4.75L16.25 2.75' />
      <path d='M6.25 14.75L4.25 16.75' />
      <path d='M14.25 14.75L16.25 16.75' />
      <path d='M0.75 9.75H4.75' />
      <path d='M15.75 9.75H19.75' />
      <rect x='4.75' y='4.75' width='11' height='13' rx='5.5' />
      <path d='M4.75 9.75H15.75' />
      <line x1='10.25' y1='9.75' x2='10.25' y2='17.75' />
    </svg>
  )
}
