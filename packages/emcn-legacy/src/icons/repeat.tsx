import type { SVGProps } from 'react'

/**
 * Repeat icon component - two arrows joined into a rectangular loop
 * @param props - SVG properties including className, fill, etc.
 */
export function Repeat(props: SVGProps<SVGSVGElement>) {
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
      <path d='M14.25 1.25L18.25 5.25L14.25 9.25' />
      <path d='M2.25 9.25V7.75C2.25 6.37 3.37 5.25 4.75 5.25H18.25' />
      <path d='M6.25 18.25L2.25 14.25L6.25 10.25' />
      <path d='M18.25 10.25V11.75C18.25 13.13 17.13 14.25 15.75 14.25H2.25' />
    </svg>
  )
}
