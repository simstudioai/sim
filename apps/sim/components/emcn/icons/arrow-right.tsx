import type { SVGProps } from 'react'

/**
 * ArrowRight icon component
 * @param props - SVG properties including className, fill, etc.
 */
export function ArrowRight(props: SVGProps<SVGSVGElement>) {
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
      <path d='M11.25 4L17.5 10.25L11.25 16.5' />
      <path d='M17.5 10.25H3' />
    </svg>
  )
}
