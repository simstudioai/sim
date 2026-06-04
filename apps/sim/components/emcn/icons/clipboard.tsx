import type { SVGProps } from 'react'

/**
 * Clipboard icon component
 * @param props - SVG properties including className, fill, etc.
 */
export function Clipboard(props: SVGProps<SVGSVGElement>) {
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
      <path d='M3.75 4.25C3.75 2.87 4.87 1.75 6.25 1.75H14.25C15.63 1.75 16.75 2.87 16.75 4.25V17.25C16.75 18.63 15.63 19.75 14.25 19.75H6.25C4.87 19.75 3.75 18.63 3.75 17.25V4.25Z' />
      <path d='M7.75 0.75H12.75V3.25C12.75 3.8 12.3 4.25 11.75 4.25H8.75C8.2 4.25 7.75 3.8 7.75 3.25V0.75Z' />
    </svg>
  )
}
