import type { SVGProps } from 'react'

/**
 * Terminal window icon component
 *
 * Redrawn on the house geometry (24-box, 1.55 stroke, round joins) so it sits at
 * the weight of the icons it shares the resource registry tab strip with. The
 * original character is kept: a window with a title bar and three chrome dots.
 *
 * @param props - SVG properties including className, fill, etc.
 */
export function TerminalWindow(props: SVGProps<SVGSVGElement>) {
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
      <path d='M3.75 2.75H16.75A2 2 0 0 1 18.75 4.75V14.75A2 2 0 0 1 16.75 16.75H3.75A2 2 0 0 1 1.75 14.75V4.75A2 2 0 0 1 3.75 2.75Z' />
      <path d='M1.75 6.75H18.75' />
      <circle cx='4.5' cy='4.75' r='0.5' />
      <circle cx='7' cy='4.75' r='0.5' />
      <circle cx='9.5' cy='4.75' r='0.5' />
    </svg>
  )
}
