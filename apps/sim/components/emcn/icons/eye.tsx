import type { SVGProps } from 'react'

/**
 * Eye icon component - almond outline with circular pupil
 * @param props - SVG properties including className, fill, etc.
 */
export function Eye(props: SVGProps<SVGSVGElement>) {
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
      <path d='M0.75 9.75C3 4.25 6.75 1.75 10.25 1.75C13.75 1.75 17.5 4.25 19.75 9.75C17.5 15.25 13.75 17.75 10.25 17.75C6.75 17.75 3 15.25 0.75 9.75Z' />
      <circle cx='10.25' cy='9.75' r='3.25' />
    </svg>
  )
}
