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
      aria-hidden='true'
      {...props}
    >
      <path
        d='M3 0C1.34 0 0 1.34 0 3V11C0 12.66 1.34 14 3 14H13C14.66 14 16 12.66 16 11V3C16 1.34 14.66 0 13 0H3ZM1 3C1 1.9 1.9 1 3 1H13C14.1 1 15 1.9 15 3V4H1V3ZM1 5H15V11C15 12.1 14.1 13 13 13H3C1.9 13 1 12.1 1 11V5Z'
        fill='currentColor'
      />
      <circle cx='3.5' cy='2.5' r='0.75' fill='currentColor' />
      <circle cx='5.75' cy='2.5' r='0.75' fill='currentColor' />
      <circle cx='8' cy='2.5' r='0.75' fill='currentColor' />
    </svg>
  )
}
