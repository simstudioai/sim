import type { SVGProps } from 'react'

/**
 * Heading1 icon component - capital H with a numeral 1 set to its right
 * @param props - SVG properties including className, fill, etc.
 */
export function Heading1(props: SVGProps<SVGSVGElement>) {
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
      <path d='M2.25 2.75V16.75' />
      <path d='M10.25 2.75V16.75' />
      <path d='M2.25 9.75H10.25' />
      <path d='M14.4 10.45L17.6 7.25V16.75' />
    </svg>
  )
}
