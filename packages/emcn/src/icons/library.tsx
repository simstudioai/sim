import type { SVGProps } from 'react'

/**
 * Library icon component - stacked log entries, each a short marker beside its line
 * @param props - SVG properties including className, fill, etc.
 */
export function Library(props: SVGProps<SVGSVGElement>) {
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
      <path d='M0.75 3.75H4.25' />
      <path d='M7.75 3.75H19.75' />
      <path d='M0.75 9.75H4.25' />
      <path d='M7.75 9.75H19.75' />
      <path d='M0.75 15.75H4.25' />
      <path d='M7.75 15.75H15.25' />
    </svg>
  )
}
