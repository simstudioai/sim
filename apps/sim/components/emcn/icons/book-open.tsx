import type { SVGProps } from 'react'

/**
 * BookOpen icon component - open book
 * @param props - SVG properties including className, fill, etc.
 */
export function BookOpen(props: SVGProps<SVGSVGElement>) {
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
      <path d='M0.75 2.75C0.75 2.75 3.25 0.75 6.25 0.75C9.25 0.75 10.25 2.75 10.25 2.75V18.75C10.25 18.75 9.25 17.25 6.25 17.25C3.25 17.25 0.75 18.75 0.75 18.75V2.75Z' />
      <path d='M10.25 2.75C10.25 2.75 11.25 0.75 14.25 0.75C17.25 0.75 19.75 2.75 19.75 2.75V18.75C19.75 18.75 17.25 17.25 14.25 17.25C11.25 17.25 10.25 18.75 10.25 18.75' />
    </svg>
  )
}
