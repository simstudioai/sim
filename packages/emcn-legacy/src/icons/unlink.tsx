import type { SVGProps } from 'react'

/**
 * Unlink icon component - a broken chain, two half links pulled apart with break marks
 * @param props - SVG properties including className, fill, etc.
 */
export function Unlink(props: SVGProps<SVGSVGElement>) {
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
      <path d='M14.35 11.17L17.89 7.63A3.9 3.9 0 0 0 12.37 2.11L8.83 5.65' />
      <path d='M6.15 8.33L2.61 11.87A3.9 3.9 0 0 0 8.13 17.39L11.67 13.85' />
      <path d='M5.72 5.22L4.31 3.81M14.78 14.28L16.19 15.69' />
    </svg>
  )
}
