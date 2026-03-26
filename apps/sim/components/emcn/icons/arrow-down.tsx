import type { SVGProps } from 'react'

/**
 * ArrowDown icon component
 * @param props - SVG properties including className, fill, etc.
 */
export function ArrowDown(props: SVGProps<SVGSVGElement>) {
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
      <path d='M4 11.25L10.25 17.5L16.5 11.25' />
      <path d='M10.25 3V17.5' />
    </svg>
  )
}
