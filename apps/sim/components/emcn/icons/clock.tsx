import type { SVGProps } from 'react'

/**
 * Clock icon component - circular clock face with hour and minute hands
 * @param props - SVG properties including className, fill, etc.
 */
export function Clock(props: SVGProps<SVGSVGElement>) {
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
      <path d='M10.25 4.75V9.75L13.75 12.25' />
    </svg>
  )
}
