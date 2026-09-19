import type { SVGProps } from 'react'

/**
 * Circled stop icon for stopped activity.
 * @param props - SVG properties including className and accessibility attributes.
 */
export function CircleStop(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='16'
      height='16'
      viewBox='0 0 16 16'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <circle cx='8' cy='8' r='6.5' stroke='currentColor' strokeWidth='1.25' />
      <rect x='6' y='6' width='4' height='4' rx='0.5' fill='currentColor' />
    </svg>
  )
}
