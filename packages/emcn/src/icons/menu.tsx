import type { SVGProps } from 'react'

/**
 * Menu icon component - three equal-length horizontal bars (hamburger)
 * @param props - SVG properties including className, fill, etc.
 */
export function Menu(props: SVGProps<SVGSVGElement>) {
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
      <path d='M1.25 3.75H19.25' />
      <path d='M1.25 9.75H19.25' />
      <path d='M1.25 15.75H19.25' />
    </svg>
  )
}
