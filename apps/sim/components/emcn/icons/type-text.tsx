import type { SVGProps } from 'react'

/**
 * Type text icon component - letter T for string columns
 * @param props - SVG properties including className, fill, etc.
 */
export function TypeText(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1.75 -1.5 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path d='M3.25 2.25H17.25' />
      <path d='M10.25 2.25V18.75' />
      <path d='M7.25 18.75H13.25' />
    </svg>
  )
}
