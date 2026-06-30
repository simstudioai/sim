import type { SVGProps } from 'react'

/**
 * Workflow icon component - two nested concentric rounded squares conveying a workflow
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
      <rect x='1.25' y='0.75' width='18' height='18' rx='4' />
      <rect x='6.25' y='5.75' width='8' height='8' rx='2' />
    </svg>
  )
}
