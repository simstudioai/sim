import type { SVGProps } from 'react'

/**
 * Rocket icon component
 * @param props - SVG properties including className, fill, etc.
 */
export function Rocket(props: SVGProps<SVGSVGElement>) {
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
      <path d='M11 1.75C8.5 4.75 7.25 8.75 7.25 12.75V15.75H14.75V12.75C14.75 8.75 13.5 4.75 11 1.75Z' />
      <path d='M7.25 12.75L4.25 15.75H7.25' />
      <path d='M14.75 12.75L17.75 15.75H14.75' />
      <circle cx='11' cy='9.75' r='1.75' />
      <path d='M9 15.75V18.25' />
      <path d='M13 15.75V18.25' />
    </svg>
  )
}
