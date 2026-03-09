import type { SVGProps } from 'react'

/**
 * Asterisk icon component - required field indicator
 * @param props - SVG properties including className, fill, etc.
 */
export function Asterisk(props: SVGProps<SVGSVGElement>) {
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
      {...props}
    >
      <path d='M10.25 3V17.5' />
      <path d='M4 6.625L16.5 13.875' />
      <path d='M4 13.875L16.5 6.625' />
    </svg>
  )
}
