import type { SVGProps } from 'react'

/**
 * Wrap icon component - shows text wrapping to next line
 * @param props - SVG properties including className, fill, etc.
 */
export function Wrap(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path d='M3 6h18' />
      <path d='M3 12h15a3 3 0 1 1 0 6h-4' />
      <path d='m11 15 3 3-3 3' />
      <path d='M3 18h7' />
    </svg>
  )
}
