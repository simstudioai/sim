import type { SVGProps } from 'react'

/**
 * Italic icon component - slanted stroke with short serifs at its top and bottom
 * @param props - SVG properties including className, fill, etc.
 */
export function Italic(props: SVGProps<SVGSVGElement>) {
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
      <path d='M8.75 1.25H16' />
      <path d='M13.5 1.25L7 18.25' />
      <path d='M4.5 18.25H11.75' />
    </svg>
  )
}
