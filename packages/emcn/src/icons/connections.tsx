import type { SVGProps } from 'react'

/**
 * Connections icon component - a four-node lattice for integrations
 *
 * Redrawn on the house geometry (24-box, 1.55 stroke, round joins) so it sits
 * at the weight of the icons it shares the resource registry with. The original
 * topology is preserved: a 2x2 grid with a circle top-right, linked left-to-
 * right along the top, down the right column, and left-to-right along the
 * bottom.
 *
 * @param props - SVG properties including className, fill, etc.
 */
export function Connections(props: SVGProps<SVGSVGElement>) {
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
      <path d='M4.25 1.25H6.25A2 2 0 0 1 8.25 3.25V5.25A2 2 0 0 1 6.25 7.25H4.25A2 2 0 0 1 2.25 5.25V3.25A2 2 0 0 1 4.25 1.25Z' />
      <path d='M15.25 1.75A2.5 2.5 0 1 1 15.25 6.75A2.5 2.5 0 1 1 15.25 1.75Z' />
      <path d='M4.25 12.75H6.25A2 2 0 0 1 8.25 14.75V16.75A2 2 0 0 1 6.25 18.75H4.25A2 2 0 0 1 2.25 16.75V14.75A2 2 0 0 1 4.25 12.75Z' />
      <path d='M14.25 12.75H16.25A2 2 0 0 1 18.25 14.75V16.75A2 2 0 0 1 16.25 18.75H14.25A2 2 0 0 1 12.25 16.75V14.75A2 2 0 0 1 14.25 12.75Z' />
      <path d='M8.25 4.25H12.75' />
      <path d='M15.25 6.75V12.75' />
      <path d='M8.25 15.75H12.25' />
    </svg>
  )
}
