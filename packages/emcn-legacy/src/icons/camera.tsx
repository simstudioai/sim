import type { SVGProps } from 'react'

/**
 * Camera icon component - camera body with a raised viewfinder bump and a centered lens
 * @param props - SVG properties including className, fill, etc.
 */
export function Camera(props: SVGProps<SVGSVGElement>) {
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
      <rect x='1.25' y='4.25' width='18' height='13.5' rx='2' />
      <path d='M7.25 4.25L8.6 2.25C8.83 1.94 9.19 1.75 9.58 1.75H10.92C11.31 1.75 11.67 1.94 11.9 2.25L13.25 4.25' />
      <circle cx='10.25' cy='11' r='3.75' />
    </svg>
  )
}
