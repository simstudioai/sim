import type { SVGProps } from 'react'

/**
 * Type percent icon component - percent sign for percent columns
 * @param props - SVG properties including className, fill, etc.
 */
export function TypePercent(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1.75 -1.5 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M16.25 4.5L4.25 16.5' />
      <circle cx='6.25' cy='6.5' r='2.25' />
      <circle cx='14.25' cy='14.5' r='2.25' />
    </svg>
  )
}
