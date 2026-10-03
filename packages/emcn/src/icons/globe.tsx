import type { SVGProps } from 'react'

/**
 * Globe icon component - circle with a meridian ellipse and two latitude lines
 * @param props - SVG properties including className, fill, etc.
 */
export function Globe(props: SVGProps<SVGSVGElement>) {
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
      <circle cx='10.25' cy='9.75' r='8' />
      <ellipse cx='10.25' cy='9.75' rx='3.4' ry='8' />
      <path d='M3.32 5.75H17.18M3.32 13.75H17.18' />
    </svg>
  )
}
