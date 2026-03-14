import type { SVGProps } from 'react'

/**
 * Plus icon component
 * @param props - SVG properties including className, fill, etc.
 */
export function Plus(props: SVGProps<SVGSVGElement>) {
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
      <path d='M10.25 3V17.5' />
      <path d='M3 10.25H17.5' />
    </svg>
  )
}
