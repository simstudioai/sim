import type { SVGProps } from 'react'

/**
 * Terminal window icon component
 * @param props - SVG properties including className, fill, etc.
 */
export function TerminalWindow(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='16'
      height='14'
      viewBox='0 0 16 14'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path
        d='M3 0C1.34315 0 0 1.34315 0 3V11C0 12.6569 1.34315 14 3 14H13C14.6569 14 16 12.6569 16 11V3C16 1.34315 14.6569 0 13 0H3ZM1 3C1 1.89543 1.89543 1 3 1H13C14.1046 1 15 1.89543 15 3V4H1V3ZM1 5H15V11C15 12.1046 14.1046 13 13 13H3C1.89543 13 1 12.1046 1 11V5Z'
        fill='currentColor'
      />
      <circle cx='3.5' cy='2.5' r='0.75' fill='currentColor' />
      <circle cx='5.75' cy='2.5' r='0.75' fill='currentColor' />
      <circle cx='8' cy='2.5' r='0.75' fill='currentColor' />
    </svg>
  )
}
