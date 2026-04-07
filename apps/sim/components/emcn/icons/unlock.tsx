import type { SVGProps } from 'react'

/**
 * Unlock icon component - open padlock
 * @param props - SVG properties including className, fill, etc.
 */
export function Unlock(props: SVGProps<SVGSVGElement>) {
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
      <rect x='2.75' y='8.75' width='15' height='10' rx='2' />
      <path d='M5.75 8.75V5.75C5.75 3.26472 7.76472 1.25 10.25 1.25C12.7353 1.25 14.75 3.26472 14.75 5.75' />
    </svg>
  )
}
