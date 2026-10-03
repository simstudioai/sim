import type { SVGProps } from 'react'

/**
 * Scissors icon component - crossed blades with ring handles
 * @param props - SVG properties including className, fill, etc.
 */
export function Scissors(props: SVGProps<SVGSVGElement>) {
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
      <path d='M5 1.7L13.65 13.64' />
      <path d='M15.5 1.7L6.85 13.64' />
      <circle cx='5.5' cy='15.5' r='2.3' />
      <circle cx='15' cy='15.5' r='2.3' />
    </svg>
  )
}
