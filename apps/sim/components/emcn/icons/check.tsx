import type { SVGProps } from 'react'

/**
 * Check icon component - checkmark
 * @param props - SVG properties including className, fill, etc.
 */
export function Check(props: SVGProps<SVGSVGElement>) {
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
      aria-hidden='true'
      {...props}
    >
      <path d='M18.25 2.75L7.25 15.75L1.75 10.25' />
    </svg>
  )
}
