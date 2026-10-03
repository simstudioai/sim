import type { SVGProps } from 'react'

/**
 * PanelRight icon component - sidebar panel docked to the right edge
 * @param props - SVG properties including className, fill, etc.
 */
export function PanelRight(props: SVGProps<SVGSVGElement>) {
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
      <path d='M0.75 3.25C0.75 1.87 1.87 0.75 3.25 0.75H17.25C18.63 0.75 19.75 1.87 19.75 3.25V16.25C19.75 17.63 18.63 18.75 17.25 18.75H3.25C1.87 18.75 0.75 17.63 0.75 16.25V3.25Z' />
      <path d='M12.25 0.75V18.75' />
    </svg>
  )
}
