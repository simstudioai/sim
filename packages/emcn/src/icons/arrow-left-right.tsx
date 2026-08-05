import type { SVGProps } from 'react'

/**
 * ArrowLeftRight icon component - stacked left and right arrows for swap toggles
 * @param props - SVG properties including className, fill, etc.
 */
export function ArrowLeftRight(props: SVGProps<SVGSVGElement>) {
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
      <path d='M6.75 1.5L2.75 5.5L6.75 9.5' />
      <path d='M2.75 5.5H17.75' />
      <path d='M13.75 10L17.75 14L13.75 18' />
      <path d='M2.75 14H17.75' />
    </svg>
  )
}
