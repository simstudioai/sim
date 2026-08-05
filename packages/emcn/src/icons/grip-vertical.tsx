import type { SVGProps } from 'react'

/**
 * GripVertical icon component - displays a 2x3 grid of dots used as a drag handle
 * @param props - SVG properties including className, fill, etc.
 */
export function GripVertical(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1 -2 24 24'
      fill='currentColor'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <circle cx='7.25' cy='4.25' r='1.1' />
      <circle cx='13.25' cy='4.25' r='1.1' />
      <circle cx='7.25' cy='10.25' r='1.1' />
      <circle cx='13.25' cy='10.25' r='1.1' />
      <circle cx='7.25' cy='16.25' r='1.1' />
      <circle cx='13.25' cy='16.25' r='1.1' />
    </svg>
  )
}
