import type { SVGProps } from 'react'

/**
 * MoreVertical icon component - three evenly spaced vertical dots
 * @param props - SVG properties including className, fill, etc.
 */
export function MoreVertical(props: SVGProps<SVGSVGElement>) {
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
      <circle cx='10.25' cy='3.75' r='0.75' />
      <circle cx='10.25' cy='9.75' r='0.75' />
      <circle cx='10.25' cy='15.75' r='0.75' />
    </svg>
  )
}
