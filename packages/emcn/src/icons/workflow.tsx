import type { SVGProps } from 'react'

/**
 * Workflow icon component - two nodes joined by an elbow connector
 * @param props - SVG properties including className, fill, etc.
 */
export function Workflow(props: SVGProps<SVGSVGElement>) {
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
      <rect x='0.75' y='0.75' width='7.5' height='7.5' rx='2' />
      <rect x='12.25' y='11.25' width='7.5' height='7.5' rx='2' />
      <path d='M8.25 4.5H14C15.1 4.5 16 5.4 16 6.5V11.25' />
    </svg>
  )
}
