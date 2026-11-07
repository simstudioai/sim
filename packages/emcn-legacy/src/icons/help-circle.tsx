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
      <path d='M7.5 7.25C7.5 5.73 8.73 4.5 10.25 4.5C11.77 4.5 13 5.73 13 7.25C13 8.68 11.75 9.05 10.95 9.85C10.5 10.3 10.25 10.75 10.25 11.5' />
      <path d='M10.25 14.5L10.26 14.5' />
    </svg>
  )
}
