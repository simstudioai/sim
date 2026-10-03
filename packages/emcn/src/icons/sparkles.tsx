import type { SVGProps } from 'react'

/**
 * Sparkles icon component - one large four-pointed star with two smaller ones
 * @param props - SVG properties including className, fill, etc.
 */
export function Sparkles(props: SVGProps<SVGSVGElement>) {
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
      <path d='M9.6 3.8C9.6 8.12 11.28 9.8 15.6 9.8C11.28 9.8 9.6 11.48 9.6 15.8C9.6 11.48 7.92 9.8 3.6 9.8C7.92 9.8 9.6 8.12 9.6 3.8Z' />
      <path d='M16.6 1.1C16.6 2.96 17.64 4 19.5 4C17.64 4 16.6 5.04 16.6 6.9C16.6 5.04 15.56 4 13.7 4C15.56 4 16.6 2.96 16.6 1.1Z' />
      <path d='M3.7 13.1C3.7 14.76 4.64 15.7 6.3 15.7C4.64 15.7 3.7 16.64 3.7 18.3C3.7 16.64 2.76 15.7 1.1 15.7C2.76 15.7 3.7 14.76 3.7 13.1Z' />
    </svg>
  )
}
