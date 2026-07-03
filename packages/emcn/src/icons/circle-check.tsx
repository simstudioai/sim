import type { SVGProps } from 'react'

/**
 * CircleCheck icon component - circular checkmark used for success intent.
 * @param props - SVG properties including className, fill, etc.
 */
export function CircleCheck(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      {...props}
    >
      <circle cx='12' cy='12' r='10' />
      <path d='m9 12 2 2 4-4' />
    </svg>
  )
}
