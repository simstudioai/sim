import type { SVGProps } from 'react'

/**
 * LogOut icon component - arrow exiting a door
 * @param props - SVG properties including className, fill, etc.
 */
export function LogOut(props: SVGProps<SVGSVGElement>) {
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
      <path d='M8.75 0.75H3.75C2.64543 0.75 1.75 1.64543 1.75 2.75V16.75C1.75 17.8546 2.64543 18.75 3.75 18.75H8.75' />
      <path d='M14.25 13.75L18.25 9.75L14.25 5.75' />
      <path d='M7.75 9.75H18.25' />
    </svg>
  )
}
