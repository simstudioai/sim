import type { SVGProps } from 'react'

/**
 * Workflow-X icon component - workflow graph with an X mark indicating a missing or deleted workflow
 * @param props - SVG properties including className, fill, etc.
 */
export function WorkflowX(props: SVGProps<SVGSVGElement>) {
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
      <circle cx='10.25' cy='3.5' r='2.75' />
      <path d='M10.25 6.25V10' />
      <path d='M5 12a2 2 0 0 1 2-2h6.5a2 2 0 0 1 2 2v2' />
      <rect x='11.5' y='14' width='7.5' height='4.75' rx='1.75' />
      <path d='M1.25 15L5.25 19' />
      <path d='M5.25 15L1.25 19' />
    </svg>
  )
}
