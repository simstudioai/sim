import type { SVGProps } from 'react'

/**
 * SlidersHorizontal icon component - three horizontal tracks, each broken by a handle
 * @param props - SVG properties including className, fill, etc.
 */
export function SlidersHorizontal(props: SVGProps<SVGSVGElement>) {
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
      <path d='M11.97 2.87H17.99' />
      <path d='M2.51 2.87H8.53' />
      <path d='M10.25 9.75H17.99' />
      <path d='M2.51 9.75H6.81' />
      <path d='M13.69 16.63H17.99' />
      <path d='M2.51 16.63H10.25' />
      <path d='M11.97 1.15V4.59' />
      <path d='M6.81 8.03V11.47' />
      <path d='M13.69 14.91V18.35' />
    </svg>
  )
}
