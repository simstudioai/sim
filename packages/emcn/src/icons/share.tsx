import type { SVGProps } from 'react'

/**
 * Share icon component - three nodes joined by two connecting lines
 * @param props - SVG properties including className, fill, etc.
 */
export function Share(props: SVGProps<SVGSVGElement>) {
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
      <circle cx='3.5' cy='9.75' r='2.5' />
      <circle cx='17' cy='3.25' r='2.5' />
      <circle cx='17' cy='16.25' r='2.5' />
      <path d='M6.29 8.41L14.21 4.59M6.29 11.09L14.21 14.91' />
    </svg>
  )
}
