import type { SVGProps } from 'react'

/**
 * Pencil icon component - edit/rename indicator
 * @param props - SVG properties including className, fill, etc.
 */
export function Pencil(props: SVGProps<SVGSVGElement>) {
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
      <path d='M14.25 0.75L19.25 5.75L5.75 19.25H0.75V14.25L14.25 0.75Z' />
      <path d='M10.75 4.25L15.75 9.25' />
    </svg>
  )
}
