import type { SVGProps } from 'react'

/**
 * CirclePause icon component - circle enclosing two vertical bars, used for waiting states
 * @param props - SVG properties including className, fill, etc.
 */
export function CirclePause(props: SVGProps<SVGSVGElement>) {
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
      <circle cx='10.25' cy='9.75' r='9' />
      <path d='M8.5 7V12.5' />
      <path d='M12 7V12.5' />
    </svg>
  )
}
