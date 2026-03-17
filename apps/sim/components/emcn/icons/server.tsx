import type { SVGProps } from 'react'

/**
 * Server icon component - stacked server boxes
 * @param props - SVG properties including className, fill, etc.
 */
export function Server(props: SVGProps<SVGSVGElement>) {
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
      {...props}
    >
      <rect x='1.75' y='0.75' width='17' height='7.5' rx='1.5' />
      <rect x='1.75' y='11.25' width='17' height='7.5' rx='1.5' />
      <circle cx='5.75' cy='4.5' r='0.75' fill='currentColor' />
      <circle cx='5.75' cy='15' r='0.75' fill='currentColor' />
    </svg>
  )
}
