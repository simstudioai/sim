import type { SVGProps } from 'react'

/**
 * Task icon component - rounded speech bubble with a tail
 * @param props - SVG properties including className, fill, etc.
 */
export function Task(props: SVGProps<SVGSVGElement>) {
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
      <path d='M0.75 3.25C0.75 1.87 1.87 0.75 3.25 0.75H17.25C18.63 0.75 19.75 1.87 19.75 3.25V12.25C19.75 13.63 18.63 14.75 17.25 14.75H8.25L4.25 18V14.75H3.25C1.87 14.75 0.75 13.63 0.75 12.25V3.25Z' />
    </svg>
  )
}
