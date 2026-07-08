import type { SVGProps } from 'react'

/**
 * PinOff icon component - thumbtack pin with diagonal strike-through
 * @param props - SVG properties including className, fill, etc.
 */
export function PinOff(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      {...props}
    >
      <path d='M12 17v5' />
      <path d='M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89' />
      <path d='m2 2 20 20' />
      <path d='M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11' />
    </svg>
  )
}
