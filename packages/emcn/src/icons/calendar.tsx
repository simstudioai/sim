import type { SVGProps } from 'react'

/**
 * Calendar icon component - calendar with binding posts and header divider
 * @param props - SVG properties including className, fill, etc.
 */
export function Calendar(props: SVGProps<SVGSVGElement>) {
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
      <rect x='0.75' y='2.75' width='19' height='16' rx='2.5' />
      <path d='M0.75 7.75H19.75' />
      <path d='M6.25 0.75V4.75' />
      <path d='M14.25 0.75V4.75' />
    </svg>
  )
}
