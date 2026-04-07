import type { SVGProps } from 'react'

/**
 * Mail icon component - envelope
 * @param props - SVG properties including className, fill, etc.
 */
export function Mail(props: SVGProps<SVGSVGElement>) {
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
      <rect x='0.75' y='2.75' width='19' height='14' rx='2' />
      <path d='M0.75 5.75L10.25 11.75L19.75 5.75' />
    </svg>
  )
}
