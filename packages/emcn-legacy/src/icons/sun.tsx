import type { SVGProps } from 'react'

/**
 * Sun icon component - centered disc with eight radiating rays for light mode
 * @param props - SVG properties including className, fill, etc.
 */
export function Sun(props: SVGProps<SVGSVGElement>) {
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
      <circle cx='10.25' cy='9.75' r='4' />
      <path d='M10.25 3.75V1.25M16.25 9.75H18.75M10.25 15.75V18.25M4.25 9.75H1.75' />
      <path d='M14.49 5.51L16.26 3.74M14.49 13.99L16.26 15.76M6.01 13.99L4.24 15.76M6.01 5.51L4.24 3.74' />
    </svg>
  )
}
