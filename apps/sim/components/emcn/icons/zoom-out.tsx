import type { SVGProps } from 'react'

/**
 * ZoomOut icon component
 * @param props - SVG properties including className, fill, etc.
 */
export function ZoomOut(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='12'
      height='12'
      viewBox='0 0 12 12'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <circle
        cx='5'
        cy='5'
        r='3.5'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M3.5 5H6.5'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M7.5 7.5L10.5 10.5'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
