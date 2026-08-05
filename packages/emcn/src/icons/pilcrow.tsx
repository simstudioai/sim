import type { SVGProps } from 'react'

/**
 * Pilcrow icon component - paragraph mark with a closed bowl and two descending stems
 * @param props - SVG properties including className, fill, etc.
 */
export function Pilcrow(props: SVGProps<SVGSVGElement>) {
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
      <path d='M18 1.75H6.5A4 4 0 0 0 6.5 9.75H10.5' />
      <path d='M10.5 1.75V17.75' />
      <path d='M15 1.75V17.75' />
    </svg>
  )
}
