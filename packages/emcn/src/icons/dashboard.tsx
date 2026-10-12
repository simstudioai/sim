import type { SVGProps } from 'react'

/**
 * Dashboard icon component - four tiles in two staggered columns, drawn on the shared
 * sidebar icon grid so it sits level with Table, Files, and Integration
 * @param props - SVG properties including className, fill, etc.
 */
export function Dashboard(props: SVGProps<SVGSVGElement>) {
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
      <rect x='0.75' y='0.75' width='8' height='9.5' rx='2' />
      <rect x='11.75' y='0.75' width='8' height='5.5' rx='2' />
      <rect x='11.75' y='9.25' width='8' height='9.5' rx='2' />
      <rect x='0.75' y='13.25' width='8' height='5.5' rx='2' />
    </svg>
  )
}
