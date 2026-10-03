import type { SVGProps } from 'react'

/**
 * Heading3 icon component - capital H with a numeral 3 set to its right
 * @param props - SVG properties including className, fill, etc.
 */
export function Heading3(props: SVGProps<SVGSVGElement>) {
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
      <path d='M13.5 8.3A2.4 2.4 0 1 1 15.5 12A2.5 2.5 0 1 1 13.3 15.5' />
    </svg>
  )
}
