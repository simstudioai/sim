import type { SVGProps } from 'react'

/**
 * HelpCircle icon component - question mark in a circle
 * @param props - SVG properties including className, fill, etc.
 */
export function HelpCircle(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <circle cx='12' cy='12' r='10' />
      <path d='M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' />
      <line x1='12' y1='17' x2='12.01' y2='17' />
    </svg>
  )
}
