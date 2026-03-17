import type { SVGProps } from 'react'

/**
 * ArrowUpDown icon component for sort toggles
 * @param props - SVG properties including className, fill, etc.
 */
export function ArrowUpDown(props: SVGProps<SVGSVGElement>) {
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
      {...props}
    >
      <path d='M1.5 8L5.5 4L9.5 8' />
      <path d='M5.5 4V16.5' />
      <path d='M11 12.5L15 16.5L19 12.5' />
      <path d='M15 4V16.5' />
    </svg>
  )
}
