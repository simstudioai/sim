import type { SVGProps } from 'react'

/**
 * Shuffle icon component for re-rolling / randomizing a set.
 * @param props - SVG properties including className, fill, etc.
 */
export function Shuffle(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M3 17h5c4 0 4-10 8-10h4' />
      <path d='M17 4l3 3-3 3' />
      <path d='M3 7h5c4 0 4 10 8 10h4' />
      <path d='M17 14l3 3-3 3' />
    </svg>
  )
}
