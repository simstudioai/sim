import type { SVGProps } from 'react'

/**
 * ListFilter icon component for filter controls
 * @param props - SVG properties including className, fill, etc.
 */
export function ListFilter(props: SVGProps<SVGSVGElement>) {
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
      <path d='M1.5 4.5H19' />
      <path d='M5 10.25H15.5' />
      <path d='M8.25 16H12.25' />
    </svg>
  )
}
