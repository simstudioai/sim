import type { SVGProps } from 'react'

/**
 * ToggleLeft icon component - pill track with the knob resting on the left
 * @param props - SVG properties including className, fill, etc.
 */
export function ToggleLeft(props: SVGProps<SVGSVGElement>) {
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
      <rect x='1.65' y='3.73' width='17.2' height='12.04' rx='6.02' />
      <circle cx='7.67' cy='9.75' r='2.58' />
    </svg>
  )
}
