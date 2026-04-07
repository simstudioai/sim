import type { SVGProps } from 'react'

/**
 * Calendar icon component - displays a calendar with date clips
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
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M0.75 5.25C0.75 3.86929 1.86929 2.75 3.25 2.75H17.25C18.6307 2.75 19.75 3.86929 19.75 5.25V16.25C19.75 17.6307 18.6307 18.75 17.25 18.75H3.25C1.86929 18.75 0.75 17.6307 0.75 16.25V5.25Z' />
      <path d='M0.75 8.25H19.75' />
      <path d='M6.25 0.25V5.25' />
      <path d='M14.25 0.25V5.25' />
    </svg>
  )
}
