import type { SVGProps } from 'react'

/**
 * Moon icon component - crescent moon for dark mode
 * @param props - SVG properties including className, fill, etc.
 */
export function Moon(props: SVGProps<SVGSVGElement>) {
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
      <path d='M10.25 1.5A5.84 5.84 0 0 0 18.5 9.75A8.25 8.25 0 1 1 10.25 1.5Z' />
    </svg>
  )
}
