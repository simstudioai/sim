import type { SVGProps } from 'react'

/**
 * CircleX icon component - circle enclosing an X, used for error and failed states
 * @param props - SVG properties including className, fill, etc.
 */
export function CircleX(props: SVGProps<SVGSVGElement>) {
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
      <circle cx='10.25' cy='9.75' r='9' />
      <path d='M13 7L7.5 12.5' />
      <path d='M7.5 7L13 12.5' />
    </svg>
  )
}
