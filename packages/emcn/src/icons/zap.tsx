import type { SVGProps } from 'react'

/**
 * Zap icon component - lightning bolt
 * @param props - SVG properties including className, fill, etc.
 */
export function Zap(props: SVGProps<SVGSVGElement>) {
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
      <path d='M11.11 1.15L2.51 11.47L10.25 11.47L9.39 18.35L17.99 8.03L10.25 8.03Z' />
    </svg>
  )
}
