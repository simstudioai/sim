import type { SVGProps } from 'react'

/**
 * Filled stop icon. Callers provide the size and fill through SVG props.
 */
export function StopFilled(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
      <rect x='4' y='4' width='16' height='16' rx='3' ry='3' />
    </svg>
  )
}
