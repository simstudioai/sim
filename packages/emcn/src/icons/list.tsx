import type { SVGProps } from 'react'

/**
 * List icon component - three lines, each preceded by a round bullet dot
 * @param props - SVG properties including className, fill, etc.
 */
export function List(props: SVGProps<SVGSVGElement>) {
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
      <path d='M6 3.75H19M6 9.75H19M6 15.75H19' />
      <circle cx='2.65' cy='3.75' r='0.7' />
      <circle cx='2.65' cy='9.75' r='0.7' />
      <circle cx='2.65' cy='15.75' r='0.7' />
    </svg>
  )
}
