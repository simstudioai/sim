import type { SVGProps } from 'react'

/**
 * Palette icon component - artist's color palette
 * @param props - SVG properties including className, fill, etc.
 */
export function Palette(props: SVGProps<SVGSVGElement>) {
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
      <path d='M10.25 0.75C5.56 0.75 0.75 4.25 0.75 9.75C0.75 14.97 5.03 18.75 10.25 18.75C11.08 18.75 11.75 18.08 11.75 17.25C11.75 16.87 11.6 16.52 11.35 16.26C11.1 15.99 10.95 15.64 10.95 15.25C10.95 14.42 11.62 13.75 12.45 13.75H14.25C17.01 13.75 19.75 11.51 19.75 8.75C19.75 4.47 15.45 0.75 10.25 0.75Z' />
      <circle cx='5.75' cy='7.25' r='1' />
      <circle cx='9.25' cy='4.5' r='1' />
      <circle cx='13.5' cy='5' r='1' />
      <circle cx='6.25' cy='11.5' r='1' />
    </svg>
  )
}
